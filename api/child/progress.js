import { cleanText, requireActiveChild, requireMethod, sendJson, supabaseAdmin } from '../_lib/server.js';

const ROOMS = new Set(['habits', 'feelings', 'leadership']);
const ALLOWED_ACTIVITIES = {
  habits: new Set(["Morning Stretch", "Bed Making Magic", "Water First", "Compliment Someone", "Help Without Asking", "Gratitude Journal", "Thanks Before Bed", "Movement Joy", "Mindful Breathing", "Self-Care Check", "Journal Time", "Calm Breathing", "Morning Star Routine", "Kindness Surprise", "Goal Sparkle", "Gratitude Stars", "Body Glow", "Rainbow Organizer", "Water Reminder", "Reading Time", "Creative Expression", "Bedtime Routine", "Evening Tidy", "Small Win", "Cozy Corner", "Beauty Moment", "Love Note", "Morning Glow Activities", "Sparkle Smile", "Outfit Prep", "Sunshine Greeting", "Day Planner", "Pack & Ready", "Morning Affirmation", "Kindness Glow Activities", "Thank You Note", "Share Something", "Listen Fully", "Kindness to Animals", "Family Time", "Smile Challenge", "Self-Kindness", "Gratitude Glow Activities", "Gratitude Photos", "Draw Your Blessings", "Appreciation List", "Good Things Hunt", "Thank You Time", "Sparkle Jar", "Nature Thanks", "Wellness Glow Activities", "Hydration Helper", "Healthy Snack", "Sleep Schedule", "Screen Break", "Fresh Air Time", "Self-Care Ritual"]),
  leadership: new Set(["Speak Your Mind", "Try Something New", "Compliment Someone", "Lead an Activity", "Goal Journal", "Include Someone", "Brave Challenge", "Mindful Breathing", "Celebrate a Win", "Presentation Practice", "Make a Decision", "Self-Care Check", "Leadership Challenge", "Inspire Someone", "Power Goals", "Share Your Voice", "Body Power", "Lead Something", "Energy Boost", "Leadership Reading", "Vision Board", "Rest & Reflect", "Calm Breathing", "Evening Plan", "Courage Check", "Confidence Journal", "Small Win", "Quiet Reflection", "Gratitude Leader", "Kind Note", "Voice Power Activities", "Share Your Opinion", "Ask a Question", "Speak Up Exercise", "Introduce Yourself", "Express a Need", "Share an Idea", "Compliment Out Loud", "Disagree Respectfully", "Courage Builder Activities", "Face a Fear", "Mistake Practice", "Comfort Zone Challenge", "Bold Choice", "Stand Up For Yourself", "Risk & Reflect", "Volunteer to Go First", "Brave Conversation", "Team Leader Activities", "Organise an Activity", "Solve a Conflict", "Delegate Tasks", "Make a Group Decision", "Teach Something", "Recognise Others", "Lead by Example", "Group Clean-Up", "Goal Achiever Activities", "Set a Weekly Goal", "Break It Down", "Create a Plan", "Daily Win Tracker", "Time Management", "Progress Check", "Obstacle Planning", "Vision Board Piece", "Celebrate Milestone"]),
  feelings: new Set(["Box Breathing", "5-4-3-2-1 Ground", "Body Scan", "Feelings Journal", "Draw Your Feelings", "Self-Compassion", "Calming Visualization", "Cold Water Reset", "Humming Calm", "Self-Hug", "Nature Moment", "Gratitude Stars", "Power Breathing", "Energy Release Dance", "Goal Setting Spark", "Share the Joy", "Savouring Practice", "Body Check-In", "Rest Ritual", "Gentle Breathing", "Write It Out", "Cozy Ritual", "Sensory Soothing", "Love Note to Self", "Breathe & Release Activities", "Breath of Fire", "Ocean Breath", "Shake It Out", "Progressive Relaxation", "Sighing Release", "Energy Run", "Ground & Center Activities", "5-4-3-2-1 Grounding", "Feet on Floor", "Room Scan", "Hand Texture", "Temperature Anchor", "Tree Visualization", "Mindful Breathing", "Here & Now", "Soothe & Comfort Activities", "Warm Drink Ritual", "Cozy Creation", "Comfort Playlist", "Gentle Self-Massage", "Love Letter to Self", "Sensory Comfort", "Express & Process Activities", "Free Writing", "Feelings Drawing", "Rip & Release", "Emotion Song", "Emotion Dictionary", "Talk to Yourself", "Emotional Wave", "Reframe Practice"])
};


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
  if (!ROOMS.has(room) || title.length < 2 || !ALLOWED_ACTIVITIES[room]?.has(title)) {
    return sendJson(res, 400, { error: 'This activity is not available in the selected room.' });
  }

  const { data, error } = await supabaseAdmin.rpc('complete_child_activity', {
    p_child_id: context.child.id,
    p_activity_key: activityKey(room, title),
    p_activity_name: title,
    p_room_slug: room,
    p_duration_minutes: durationMinutes
  });
  if (error) {
    if (error.message?.includes('daily gem limit reached')) return sendJson(res, 429, { error: 'You have reached today’s gem limit. Come back tomorrow for more activities.' });
    throw error;
  }

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

async function challenges(req, res) {
  const context = await requireActiveChild(req);
  if (context.error) return sendJson(res, context.status, { error: context.error });
  const childId = context.child.id;

  if (req.method === 'GET') {
    const room = cleanText(req.query?.room, 20).toLocaleLowerCase('en-GB');
    if (!ROOMS.has(room)) return sendJson(res, 400, { error: 'Invalid challenge room.' });
    const { data, error } = await supabaseAdmin
      .from('child_challenges')
      .select('id,challenge_name,room_slug,status,started_on,child_challenge_checkins(checkin_date)')
      .eq('child_id', childId)
      .eq('room_slug', room)
      .eq('status', 'active')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return sendJson(res, 200, {
      challenges: (data || []).map(challenge => {
        const checkins = (challenge.child_challenge_checkins || []).map(item => item.checkin_date).sort();
        return {
          id: challenge.id,
          habit: challenge.challenge_name,
          currentDay: checkins.length,
          lastMarkedDate: checkins.at(-1) || '',
          startedOn: challenge.started_on
        };
      })
    });
  }

  if (req.method === 'POST') {
    const room = cleanText(req.body?.room, 20).toLocaleLowerCase('en-GB');
    const challengeName = cleanText(req.body?.challengeName, 80);
    if (!ROOMS.has(room) || challengeName.length < 2) return sendJson(res, 400, { error: 'Choose a valid challenge.' });
    const { count, error: countError } = await supabaseAdmin.from('child_challenges')
      .select('id', { count: 'exact', head: true }).eq('child_id', childId).eq('room_slug', room).eq('status', 'active');
    if (countError) throw countError;
    if ((count || 0) >= 3) return sendJson(res, 409, { error: 'Finish or remove a challenge before adding another one.' });
    const { data: existing, error: existingError } = await supabaseAdmin.from('child_challenges')
      .select('id').eq('child_id', childId).eq('room_slug', room).eq('challenge_name', challengeName).eq('status', 'active').maybeSingle();
    if (existingError) throw existingError;
    if (existing) return sendJson(res, 409, { error: 'You are already tracking this challenge.' });
    const { data, error } = await supabaseAdmin.from('child_challenges')
      .insert({ child_id: childId, room_slug: room, challenge_name: challengeName })
      .select('id,challenge_name,started_on').single();
    if (error) throw error;
    return sendJson(res, 201, { success: true, challenge: data });
  }

  if (req.method === 'PATCH') {
    const challengeId = cleanText(req.body?.challengeId, 50);
    if (!/^[0-9a-f-]{36}$/i.test(challengeId)) return sendJson(res, 400, { error: 'Invalid challenge.' });
    const { data, error } = await supabaseAdmin.rpc('checkin_child_challenge', { p_child_id: childId, p_challenge_id: challengeId });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    return sendJson(res, 200, {
      success: true,
      alreadyMarked: !result?.marked,
      currentDay: Number(result?.current_day || 0),
      completed: Boolean(result?.completed),
      bonusGems: Number(result?.bonus_gems || 0),
      gemBalance: Number(result?.gem_balance || 0)
    });
  }

  if (req.method === 'DELETE') {
    const challengeId = cleanText(req.body?.challengeId || req.query?.challengeId, 50);
    if (!/^[0-9a-f-]{36}$/i.test(challengeId)) return sendJson(res, 400, { error: 'Invalid challenge.' });
    const { data, error } = await supabaseAdmin.from('child_challenges')
      .update({ status: 'archived' }).eq('id', challengeId).eq('child_id', childId).eq('status', 'active').select('id').maybeSingle();
    if (error) throw error;
    if (!data) return sendJson(res, 404, { error: 'Challenge not found.' });
    return sendJson(res, 200, { success: true });
  }

  return sendJson(res, 405, { error: 'Method not allowed.' });
}

export default async function handler(req, res) {
  try {
    const action = actionFrom(req);
    if (action === 'dashboard') return await dashboard(req, res);
    if (action === 'complete') return await complete(req, res);
    if (action === 'challenges') return await challenges(req, res);
    return sendJson(res, 404, { error: 'Child progress action not found.' });
  } catch (error) {
    console.error('[child/progress]', error);
    return sendJson(res, 500, { error: 'Unable to complete the child progress request.' });
  }
}
