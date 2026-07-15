import {
  cleanText,
  clearChildSessionCookie,
  createChildSessionToken,
  getSubscriptionAccess,
  isValidPin,
  normaliseLoginName,
  requestFingerprint,
  requireActiveChild,
  requireMethod,
  sendJson,
  setChildSessionCookie,
  supabaseAdmin,
  verifyPin
} from '../_lib/server.js';

const DUMMY_PIN_HASH = 'scrypt$MDEyMzQ1Njc4OWFiY2RlZg$PVMcZ7OD8zDUjPRzqiIpDj0bcYWzj0PaDTtgFmYtcvskdxnZJnph7IaKHX17tY7MCV1GgQO3PdhODbepYfTF8Q';

function actionFrom(req) {
  return cleanText(req.query?.action || '', 20).toLocaleLowerCase('en-GB');
}

async function login(req, res) {
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

  const pinMatches = verifyPin(pin, credential?.pin_hash || DUMMY_PIN_HASH);
  const success = Boolean(child && credential && pinMatches);
  const { error: auditError } = await supabaseAdmin.from('child_login_attempts').insert([
    { fingerprint, success },
    { fingerprint: globalFingerprint, success }
  ]);
  if (auditError) throw auditError;

  if (!success) {
    return sendJson(res, 401, { error: 'Those details do not match. Check the family code, name and PIN.' });
  }

  const access = await getSubscriptionAccess(child.parent_user_id);
  if (!access.active) {
    return sendJson(res, 402, { error: 'The family membership is not active. Please ask your parent to update billing.' });
  }

  const token = createChildSessionToken({
    childId: child.id,
    parentUserId: child.parent_user_id,
    sessionVersion: credential.session_version
  });
  setChildSessionCookie(res, token);

  await supabaseAdmin
    .from('child_profiles')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', child.id);

  return sendJson(res, 200, {
    success: true,
    child: { id: child.id, displayName: child.display_name, avatarKey: child.avatar_key }
  });
}

async function logout(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  clearChildSessionCookie(res);
  return sendJson(res, 200, { success: true });
}

async function session(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  const context = await requireActiveChild(req);
  if (context.error) {
    if (context.status === 401) clearChildSessionCookie(res);
    return sendJson(res, context.status, { active: false, error: context.error });
  }

  const { data: wallet, error } = await supabaseAdmin
    .from('child_wallets')
    .select('gem_balance,lifetime_gems')
    .eq('child_id', context.child.id)
    .single();
  if (error) throw error;

  return sendJson(res, 200, {
    active: true,
    child: {
      id: context.child.id,
      displayName: context.child.display_name,
      avatarKey: context.child.avatar_key,
      ageBand: context.child.age_band
    },
    wallet
  });
}

export default async function handler(req, res) {
  try {
    const action = actionFrom(req);
    if (action === 'login') return await login(req, res);
    if (action === 'logout') return await logout(req, res);
    if (action === 'session') return await session(req, res);
    return sendJson(res, 404, { error: 'Child account action not found.' });
  } catch (error) {
    console.error('[child/auth]', error);
    return sendJson(res, 500, { error: 'Unable to complete the child account request.' });
  }
}
