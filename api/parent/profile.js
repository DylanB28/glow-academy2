import { cleanText, getOrCreateParentProfile, requireMethod, sendJson, supabaseAdmin, verifyParentRequest } from '../_lib/server.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, ['GET', 'PATCH'])) return;
  try {
    const auth = await verifyParentRequest(req);
    if (!auth) return sendJson(res, 401, { error: 'Parent sign-in required.' });
    const profile = await getOrCreateParentProfile(auth.user);

    if (req.method === 'GET') return sendJson(res, 200, { profile });

    const displayName = cleanText(req.body?.displayName, 80);
    const { data, error } = await supabaseAdmin
      .from('parent_profiles')
      .update({ display_name: displayName || null, updated_at: new Date().toISOString() })
      .eq('user_id', auth.user.id)
      .select('*')
      .single();
    if (error) throw error;
    return sendJson(res, 200, { success: true, profile: data });
  } catch (error) {
    console.error('[parent/profile]', error);
    return sendJson(res, 500, { error: 'Unable to update the parent profile.' });
  }
}
