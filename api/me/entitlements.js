import {
  getOrCreateParentProfile,
  getSubscriptionAccess,
  requireActiveChild,
  requireMethod,
  sendJson,
  supabaseAdmin,
  verifyParentRequest
} from '../_lib/server.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  try {
    const childContext = await requireActiveChild(req);
    if (!childContext.error) {
      return sendJson(res, 200, {
        role: 'child', loggedIn: true, active: true, billingIssue: childContext.access.billingIssue,
        child: { id: childContext.child.id, displayName: childContext.child.display_name, avatarKey: childContext.child.avatar_key }
      });
    }
    const parentAuth = await verifyParentRequest(req);
    if (!parentAuth) return sendJson(res, 200, { role: 'guest', loggedIn: false, active: false });
    const profile = await getOrCreateParentProfile(parentAuth.user);
    const access = await getSubscriptionAccess(parentAuth.user.id);
    const { count, error } = await supabaseAdmin.from('child_profiles').select('id', { count: 'exact', head: true }).eq('parent_user_id', parentAuth.user.id).eq('status', 'active');
    if (error) throw error;
    return sendJson(res, 200, { role: 'parent', loggedIn: true, active: access.active, billingIssue: access.billingIssue, subscriptionStatus: access.status, profileComplete: Boolean(profile.onboarding_completed), childrenCount: count || 0, familyCode: profile.family_code });
  } catch (error) {
    console.error('[entitlements]', error);
    return sendJson(res, 500, { error: 'Unable to check account access.' });
  }
}
