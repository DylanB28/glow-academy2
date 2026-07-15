import { cleanText, requireActiveChild, requireMethod, sendJson, supabaseAdmin } from '../_lib/server.js';

function actionFrom(req) {
  return cleanText(req.query?.action || 'layout', 20).toLocaleLowerCase('en-GB');
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

async function rewards(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
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
}

async function buy(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  const context = await requireActiveChild(req);
  if (context.error) return sendJson(res, context.status, { error: context.error });
  const itemId = cleanText(req.body?.itemId, 50);
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return sendJson(res, 400, { error: 'Invalid item.' });

  const { data, error } = await supabaseAdmin.rpc('purchase_reward_item', {
    p_child_id: context.child.id,
    p_item_id: itemId
  });
  if (error) {
    if (error.message?.includes('not enough gems')) return sendJson(res, 409, { error: 'You need more gems for this item.' });
    if (error.message?.includes('already owned')) return sendJson(res, 409, { error: 'You already own this item.' });
    throw error;
  }
  const result = Array.isArray(data) ? data[0] : data;
  return sendJson(res, 200, {
    success: true,
    inventoryId: result?.inventory_id,
    gemBalance: Number(result?.gem_balance || 0)
  });
}

async function layout(req, res) {
  if (!requireMethod(req, res, ['GET', 'POST'])) return;
  const context = await requireActiveChild(req);
  if (context.error) return sendJson(res, context.status, { error: context.error });

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('palace_placements')
      .select('id,inventory_id,item_id,x_percent,y_percent,scale,rotation,z_index,room_key')
      .eq('child_id', context.child.id)
      .order('z_index', { ascending: true });
    if (error) throw error;
    return sendJson(res, 200, { placements: data || [] });
  }

  const incoming = Array.isArray(req.body?.placements) ? req.body.placements.slice(0, 100) : [];
  const placements = incoming.flatMap((placement, index) => {
    const inventoryId = cleanText(placement.inventoryId, 50);
    if (!/^[0-9a-f-]{36}$/i.test(inventoryId)) return [];
    return [{
      inventory_id: inventoryId,
      x_percent: clamp(placement.xPercent, 0, 94, 40),
      y_percent: clamp(placement.yPercent, 5, 88, 50),
      scale: clamp(placement.scale, 0.5, 2.5, 1),
      rotation: clamp(placement.rotation, -25, 25, 0),
      z_index: Math.min(200, Math.max(1, Number.parseInt(placement.zIndex || index + 1, 10)))
    }];
  });

  const { data, error } = await supabaseAdmin.rpc('save_child_palace', {
    p_child_id: context.child.id,
    p_room_key: 'main',
    p_placements: placements
  });
  if (error) throw error;

  return sendJson(res, 200, { success: true, saved: Number(data || 0) });
}

export default async function handler(req, res) {
  try {
    const action = actionFrom(req);
    if (action === 'rewards') return await rewards(req, res);
    if (action === 'buy') return await buy(req, res);
    if (action === 'layout') return await layout(req, res);
    return sendJson(res, 404, { error: 'Palace action not found.' });
  } catch (error) {
    console.error('[child/palace]', error);
    return sendJson(res, 500, { error: 'Unable to complete the palace request.' });
  }
}
