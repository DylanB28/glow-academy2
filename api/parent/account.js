import {
  cleanText,
  getOrCreateParentProfile,
  getSubscriptionAccess,
  hashPin,
  isValidPin,
  normaliseLoginName,
  requireMethod,
  sendJson,
  supabaseAdmin,
  verifyParentRequest
} from '../_lib/server.js';

const AVATARS = new Set(['crown', 'star', 'butterfly', 'rainbow', 'heart', 'diamond']);
const AGE_BANDS = new Set(['7-9', '10-12', '13-15']);
const MAX_CHILDREN = Math.max(1, Math.min(10, Number.parseInt(process.env.MAX_CHILDREN_PER_FAMILY || '3', 10)));

function actionFrom(req) {
  return cleanText(req.query?.action || '', 20).toLocaleLowerCase('en-GB');
}

async function parentContext(req, res) {
  const auth = await verifyParentRequest(req);
  if (!auth) {
    sendJson(res, 401, { error: 'Parent sign-in required.' });
    return null;
  }
  const profile = await getOrCreateParentProfile(auth.user);
  const access = await getSubscriptionAccess(auth.user.id);
  return { ...auth, profile, access };
}

async function listChildren(userId) {
  const { data, error } = await supabaseAdmin
    .from('child_profiles')
    .select('id,display_name,login_name,age_band,avatar_key,status,created_at,last_login_at,child_wallets(gem_balance,lifetime_gems,gems_habits,gems_feelings,gems_leadership)')
    .eq('parent_user_id', userId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function profile(req, res) {
  if (!requireMethod(req, res, ['GET', 'PATCH'])) return;
  const auth = await verifyParentRequest(req);
  if (!auth) return sendJson(res, 401, { error: 'Parent sign-in required.' });
  const currentProfile = await getOrCreateParentProfile(auth.user);

  if (req.method === 'GET') return sendJson(res, 200, { profile: currentProfile });

  const displayName = cleanText(req.body?.displayName, 80);
  const { data, error } = await supabaseAdmin
    .from('parent_profiles')
    .update({ display_name: displayName || null, updated_at: new Date().toISOString() })
    .eq('user_id', auth.user.id)
    .select('*')
    .single();
  if (error) throw error;
  return sendJson(res, 200, { success: true, profile: data });
}

async function children(req, res) {
  if (!requireMethod(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
  const context = await parentContext(req, res);
  if (!context) return;

  if (req.method === 'GET') {
    const childrenList = await listChildren(context.user.id);
    return sendJson(res, 200, {
      parent: {
        email: context.user.email,
        displayName: context.profile.display_name,
        familyCode: context.profile.family_code,
        onboardingCompleted: context.profile.onboarding_completed
      },
      membership: {
        active: context.access.active,
        status: context.access.status,
        billingIssue: context.access.billingIssue
      },
      maxChildren: MAX_CHILDREN,
      children: childrenList
    });
  }

  if (!context.access.active) {
    return sendJson(res, 402, { error: 'An active membership is required to manage child profiles.' });
  }

  if (req.method === 'POST') {
    const displayName = cleanText(req.body?.displayName, 40);
    const loginName = normaliseLoginName(displayName);
    const ageBand = cleanText(req.body?.ageBand, 10);
    const avatarKey = cleanText(req.body?.avatarKey, 20);
    const pin = String(req.body?.pin || '');
    if (displayName.length < 2 || !AGE_BANDS.has(ageBand) || !AVATARS.has(avatarKey) || !isValidPin(pin)) {
      return sendJson(res, 400, { error: 'Add a child name, age range, avatar and 4-digit PIN.' });
    }

    const { count, error: countError } = await supabaseAdmin
      .from('child_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('parent_user_id', context.user.id)
      .eq('status', 'active');
    if (countError) throw countError;
    if ((count || 0) >= MAX_CHILDREN) {
      return sendJson(res, 409, { error: `This membership supports up to ${MAX_CHILDREN} child profiles.` });
    }

    const { data: child, error: childError } = await supabaseAdmin
      .from('child_profiles')
      .insert({ parent_user_id: context.user.id, display_name: displayName, login_name: loginName, age_band: ageBand, avatar_key: avatarKey })
      .select('id,display_name,login_name,age_band,avatar_key,status,created_at')
      .single();
    if (childError) {
      if (childError.code === '23505') return sendJson(res, 409, { error: 'Use a different child name for this family.' });
      throw childError;
    }

    const { error: credentialError } = await supabaseAdmin
      .from('child_credentials')
      .insert({ child_id: child.id, pin_hash: hashPin(pin) });
    if (credentialError) {
      await supabaseAdmin.from('child_profiles').delete().eq('id', child.id);
      throw credentialError;
    }

    await supabaseAdmin
      .from('parent_profiles')
      .update({ onboarding_completed: true, updated_at: new Date().toISOString() })
      .eq('user_id', context.user.id);

    return sendJson(res, 201, { success: true, child });
  }

  const childId = cleanText(req.body?.childId || req.query?.childId, 50);
  if (!/^[0-9a-f-]{36}$/i.test(childId)) return sendJson(res, 400, { error: 'Invalid child profile.' });

  const { data: ownedChild, error: ownedError } = await supabaseAdmin
    .from('child_profiles')
    .select('id,status')
    .eq('id', childId)
    .eq('parent_user_id', context.user.id)
    .maybeSingle();
  if (ownedError) throw ownedError;
  if (!ownedChild) return sendJson(res, 404, { error: 'Child profile not found.' });

  if (req.method === 'DELETE') {
    const { error } = await supabaseAdmin
      .from('child_profiles')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', childId)
      .eq('parent_user_id', context.user.id);
    if (error) throw error;
    const { error: invalidateError } = await supabaseAdmin.rpc('invalidate_child_sessions', { p_child_id: childId });
    if (invalidateError) throw invalidateError;
    return sendJson(res, 200, { success: true });
  }

  const updates = {};
  if (req.body?.displayName !== undefined) {
    const displayName = cleanText(req.body.displayName, 40);
    if (displayName.length < 2) return sendJson(res, 400, { error: 'Child name is too short.' });
    updates.display_name = displayName;
    updates.login_name = normaliseLoginName(displayName);
  }
  if (req.body?.ageBand !== undefined) {
    const ageBand = cleanText(req.body.ageBand, 10);
    if (!AGE_BANDS.has(ageBand)) return sendJson(res, 400, { error: 'Invalid age range.' });
    updates.age_band = ageBand;
  }
  if (req.body?.avatarKey !== undefined) {
    const avatarKey = cleanText(req.body.avatarKey, 20);
    if (!AVATARS.has(avatarKey)) return sendJson(res, 400, { error: 'Invalid avatar.' });
    updates.avatar_key = avatarKey;
  }
  if (req.body?.status === 'active' && ownedChild.status !== 'active') {
    const { count, error: countError } = await supabaseAdmin.from('child_profiles').select('id', { count: 'exact', head: true }).eq('parent_user_id', context.user.id).eq('status', 'active');
    if (countError) throw countError;
    if ((count || 0) >= MAX_CHILDREN) return sendJson(res, 409, { error: `This membership supports up to ${MAX_CHILDREN} active child profiles.` });
    updates.status = 'active';
  }

  if (Object.keys(updates).length) {
    updates.updated_at = new Date().toISOString();
    const { error } = await supabaseAdmin.from('child_profiles').update(updates).eq('id', childId).eq('parent_user_id', context.user.id);
    if (error) {
      if (error.code === '23505') return sendJson(res, 409, { error: 'Use a different child name for this family.' });
      throw error;
    }
  }

  if (updates.status === 'active') {
    const { error: invalidateError } = await supabaseAdmin.rpc('invalidate_child_sessions', { p_child_id: childId });
    if (invalidateError) throw invalidateError;
  }

  if (req.body?.pin !== undefined) {
    const pin = String(req.body.pin || '');
    if (!isValidPin(pin)) return sendJson(res, 400, { error: 'PIN must contain exactly 4 numbers.' });
    const { error } = await supabaseAdmin.rpc('rotate_child_pin', {
      p_child_id: childId,
      p_pin_hash: hashPin(pin)
    });
    if (error) throw error;
  }

  return sendJson(res, 200, { success: true });
}

export default async function handler(req, res) {
  try {
    const action = actionFrom(req);
    if (action === 'profile') return await profile(req, res);
    if (action === 'children') return await children(req, res);
    return sendJson(res, 404, { error: 'Parent account action not found.' });
  } catch (error) {
    console.error('[parent/account]', error);
    return sendJson(res, 500, { error: 'Unable to complete the parent account request.' });
  }
}
