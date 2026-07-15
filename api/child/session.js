import { clearChildSessionCookie, requireActiveChild, requireMethod, sendJson, supabaseAdmin } from '../_lib/server.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  try {
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
  } catch (error) {
    console.error('[child/session]', error);
    return sendJson(res, 500, { active: false, error: 'Unable to load the child session.' });
  }
}
