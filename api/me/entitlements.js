import {
  getChildSession,
  getOrCreateParentProfile,
  getSubscriptionAccess,
  requireMethod,
  sendJson,
  supabaseAdmin,
  verifyParentRequest
} from '../_lib/server.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'GET')) return;

  try {
    const childSession = getChildSession(req);
    if (childSession) {
      const { data: child } = await supabaseAdmin
        .from('child_profiles')
        .select('id,parent_user_id,display_name,avatar_key,status')
        .eq('id', childSession.child_id)
        .eq('parent_user_id', childSession.parent_user_id)
        .eq('status', 'active')
        .maybeSingle();
      if (child) {
        const access = await getSubscriptionAccess(child.parent_user_id);
        return sendJson(res, 200, {
          role: 'child',
          loggedIn: true,
          active: access.active,
          billingIssue: access.billingIssue,
          child: { id: child.id, displayName: child.display_name, avatarKey: child.avatar_key }
        });
      }
    }

    const parentAuth = await verifyParentRequest(req);
    if (!parentAuth) {
      return sendJson(res, 200, { role: 'guest', loggedIn: false, active: false });
    }

    const profile = await getOrCreateParentProfile(parentAuth.user);
    const access = await getSubscriptionAccess(parentAuth.user.id);
    const { count, error: countError } = await supabaseAdmin
      .from('child_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('parent_user_id', parentAuth.user.id)
      .eq('status', 'active');
    if (countError) throw countError;

    return sendJson(res, 200, {
      role: 'parent',
      loggedIn: true,
      active: access.active,
      billingIssue: access.billingIssue,
      subscriptionStatus: access.status,
      profileComplete: Boolean(profile.onboarding_completed),
      childrenCount: count || 0,
      familyCode: profile.family_code
    });
  } catch (error) {
    console.error('[entitlements]', error);
    return sendJson(res, 500, { error: 'Unable to check account access.' });
  }
}
