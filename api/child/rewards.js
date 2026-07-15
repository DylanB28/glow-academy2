import { requireActiveChild, requireMethod, sendJson, supabaseAdmin } from '../_lib/server.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  try {
    const context = await requireActiveChild(req);
    if (context.error) return sendJson(res, context.status, { error: context.error });

    const [itemsResult, inventoryResult, walletResult, placementsResult] = await Promise.all([
      supabaseAdmin.from('reward_items')
        .select('id,item_key,name,category,description,price_gems,icon_text,default_width,default_height,layer,is_starter')
        .eq('is_active', true).order('sort_order', { ascending: true }),
      supabaseAdmin.from('child_inventory')
        .select('id,item_id,quantity,purchased_at,reward_items(id,item_key,name,category,description,price_gems,icon_text,default_width,default_height,layer)')
        .eq('child_id', context.child.id),
      supabaseAdmin.from('child_wallets').select('*').eq('child_id', context.child.id).single(),
      supabaseAdmin.from('palace_placements')
        .select('id,inventory_id,item_id,x_percent,y_percent,scale,rotation,z_index,room_key')
        .eq('child_id', context.child.id).order('z_index', { ascending: true })
    ]);

    for (const result of [itemsResult, inventoryResult, walletResult, placementsResult]) {
      if (result.error) throw result.error;
    }

    return sendJson(res, 200, {
      child: { id: context.child.id, displayName: context.child.display_name },
      wallet: walletResult.data,
      items: itemsResult.data || [],
      inventory: inventoryResult.data || [],
      placements: placementsResult.data || []
    });
  } catch (error) {
    console.error('[child/rewards]', error);
    return sendJson(res, 500, { error: 'Unable to load the palace shop.' });
  }
}
