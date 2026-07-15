import { requireActiveChild, requireMethod, sendJson, supabaseAdmin } from '../_lib/server.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  try {
    const context = await requireActiveChild(req);
    if (context.error) return sendJson(res, context.status, { error: context.error });
    const childId = context.child.id;

    const [walletResult, recentResult, inventoryResult, placementsResult, catalogResult] = await Promise.all([
      supabaseAdmin.from('child_wallets').select('*').eq('child_id', childId).single(),
      supabaseAdmin.from('activity_completions')
        .select('id,activity_name,room_slug,gems_earned,completed_at')
        .eq('child_id', childId).order('completed_at', { ascending: false }).limit(8),
      supabaseAdmin.from('child_inventory').select('id', { count: 'exact', head: true }).eq('child_id', childId),
      supabaseAdmin.from('palace_placements').select('id', { count: 'exact', head: true }).eq('child_id', childId),
      supabaseAdmin.from('reward_items').select('id', { count: 'exact', head: true }).eq('is_active', true)
    ]);

    for (const result of [walletResult, recentResult, inventoryResult, placementsResult, catalogResult]) {
      if (result.error) throw result.error;
    }

    return sendJson(res, 200, {
      child: {
        id: context.child.id,
        displayName: context.child.display_name,
        avatarKey: context.child.avatar_key
      },
      wallet: walletResult.data,
      recentActivities: recentResult.data || [],
      inventoryCount: inventoryResult.count || 0,
      placedCount: placementsResult.count || 0,
      catalogCount: catalogResult.count || 0,
      billingIssue: context.access.billingIssue
    });
  } catch (error) {
    console.error('[child/dashboard]', error);
    return sendJson(res, 500, { error: 'Unable to load the dashboard.' });
  }
}
