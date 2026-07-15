import { cleanText, requireActiveChild, requireMethod, sendJson, supabaseAdmin } from '../_lib/server.js';

const ROOMS = new Set(['habits', 'feelings', 'leadership']);

function activityKey(room, title) {
  const slug = cleanText(title, 100)
    .toLocaleLowerCase('en-GB')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
  return `${room}:${slug || 'activity'}`;
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  try {
    const context = await requireActiveChild(req);
    if (context.error) return sendJson(res, context.status, { error: context.error });

    const room = cleanText(req.body?.room, 20).toLocaleLowerCase('en-GB');
    const title = cleanText(req.body?.activityTitle, 120);
    const durationMinutes = Math.max(0, Math.min(120, Number.parseInt(req.body?.durationMinutes || 0, 10) || 0));
    if (!ROOMS.has(room) || title.length < 2) {
      return sendJson(res, 400, { error: 'Invalid activity.' });
    }

    const { data, error } = await supabaseAdmin.rpc('complete_child_activity', {
      p_child_id: context.child.id,
      p_activity_key: activityKey(room, title),
      p_activity_name: title,
      p_room_slug: room,
      p_duration_minutes: durationMinutes
    });
    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;
    return sendJson(res, 200, {
      success: true,
      awarded: Boolean(result?.awarded),
      duplicate: !result?.awarded,
      wallet: {
        gemBalance: Number(result?.gem_balance || 0),
        lifetimeGems: Number(result?.lifetime_gems || 0),
        habits: Number(result?.gems_habits || 0),
        feelings: Number(result?.gems_feelings || 0),
        leadership: Number(result?.gems_leadership || 0)
      }
    });
  } catch (error) {
    console.error('[child/complete-activity]', error);
    return sendJson(res, 500, { error: 'The activity could not be saved. Your gem was not changed.' });
  }
}
