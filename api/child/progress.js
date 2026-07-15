import { cleanText, requireActiveChild, requireMethod, sendJson, supabaseAdmin } from '../_lib/server.js';

const ROOMS = new Set(['habits', 'feelings', 'leadership']);

function actionFrom(req) {
  return cleanText(req.query?.action || '', 20).toLocaleLowerCase('en-GB');
}

function activityKey(room, title) {
  const slug = cleanText(title, 100)
    .toLocaleLowerCase('en-GB')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
  return `${room}:${slug || 'activity'}`;
}

async function dashboard(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
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
}

async function complete(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
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
}

export default async function handler(req, res) {
  try {
    const action = actionFrom(req);
    if (action === 'dashboard') return await dashboard(req, res);
    if (action === 'complete') return await complete(req, res);
    return sendJson(res, 404, { error: 'Child progress action not found.' });
  } catch (error) {
    console.error('[child/progress]', error);
    return sendJson(res, 500, { error: 'Unable to complete the child progress request.' });
  }
}
