import {
  cleanText,
  createChildSessionToken,
  getSubscriptionAccess,
  isValidPin,
  normaliseLoginName,
  requestFingerprint,
  requireMethod,
  sendJson,
  setChildSessionCookie,
  supabaseAdmin,
  verifyPin
} from '../_lib/server.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;

  const familyCode = cleanText(req.body?.familyCode, 12).toUpperCase();
  const displayName = cleanText(req.body?.displayName, 40);
  const loginName = normaliseLoginName(displayName);
  const pin = String(req.body?.pin || '');

  if (!/^[A-Z2-9]{8}$/.test(familyCode) || !loginName || !isValidPin(pin)) {
    return sendJson(res, 400, { error: 'Enter the family code, child name and 4-digit PIN.' });
  }

  const fingerprint = requestFingerprint(req, [familyCode, loginName]);
  const globalFingerprint = requestFingerprint(req, ['child-login-global']);

  try {
    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const [specificRate, globalRate] = await Promise.all([
      supabaseAdmin.from('child_login_attempts').select('id', { count: 'exact', head: true })
        .eq('fingerprint', fingerprint).eq('success', false).gte('attempted_at', windowStart),
      supabaseAdmin.from('child_login_attempts').select('id', { count: 'exact', head: true })
        .eq('fingerprint', globalFingerprint).eq('success', false).gte('attempted_at', windowStart)
    ]);
    if (specificRate.error) throw specificRate.error;
    if (globalRate.error) throw globalRate.error;
    if ((specificRate.count || 0) >= 10 || (globalRate.count || 0) >= 30) {
      return sendJson(res, 429, { error: 'Too many attempts. Please wait 15 minutes or ask your parent to reset the PIN.' });
    }

    const { data: parent, error: parentError } = await supabaseAdmin
      .from('parent_profiles')
      .select('user_id')
      .eq('family_code', familyCode)
      .maybeSingle();
    if (parentError) throw parentError;

    let child = null;
    let credential = null;
    if (parent) {
      const { data: childData, error: childError } = await supabaseAdmin
        .from('child_profiles')
        .select('id,parent_user_id,display_name,login_name,avatar_key,status')
        .eq('parent_user_id', parent.user_id)
        .eq('login_name', loginName)
        .eq('status', 'active')
        .maybeSingle();
      if (childError) throw childError;
      child = childData;

      if (child) {
        const { data: credentialData, error: credentialError } = await supabaseAdmin
          .from('child_credentials')
          .select('pin_hash,session_version')
          .eq('child_id', child.id)
          .maybeSingle();
        if (credentialError) throw credentialError;
        credential = credentialData;
      }
    }

    const success = Boolean(child && credential && verifyPin(pin, credential.pin_hash));
    await supabaseAdmin.from('child_login_attempts').insert([
      { fingerprint, success },
      { fingerprint: globalFingerprint, success }
    ]);

    if (!success) {
      return sendJson(res, 401, { error: 'Those details do not match. Check the family code, name and PIN.' });
    }

    const access = await getSubscriptionAccess(child.parent_user_id);
    if (!access.active) {
      return sendJson(res, 402, { error: 'The family membership is not active. Please ask your parent to update billing.' });
    }

    const token = createChildSessionToken({ childId: child.id, parentUserId: child.parent_user_id, sessionVersion: credential.session_version });
    setChildSessionCookie(res, token);

    await supabaseAdmin
      .from('child_profiles')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', child.id);

    return sendJson(res, 200, {
      success: true,
      child: { id: child.id, displayName: child.display_name, avatarKey: child.avatar_key }
    });
  } catch (error) {
    console.error('[child/login]', error);
    return sendJson(res, 500, { error: 'Unable to sign in right now. Please try again.' });
  }
}
