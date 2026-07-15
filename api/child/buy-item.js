import { cleanText, requireActiveChild, requireMethod, sendJson, supabaseAdmin } from '../_lib/server.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  try {
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
  } catch (error) {
    console.error('[child/buy-item]', error);
    return sendJson(res, 500, { error: 'The item could not be purchased.' });
  }
}
