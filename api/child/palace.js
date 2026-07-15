import { cleanText, requireActiveChild, requireMethod, sendJson, supabaseAdmin } from '../_lib/server.js';

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, ['GET', 'POST'])) return;
  try {
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
  } catch (error) {
    console.error('[child/palace]', error);
    return sendJson(res, 500, { error: 'The palace layout could not be saved.' });
  }
}
