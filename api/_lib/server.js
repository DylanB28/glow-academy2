import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.warn('[Gem Glow] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.');
}

export const supabaseAdmin = createClient(
  SUPABASE_URL || 'https://invalid.local',
  SERVICE_ROLE_KEY || 'invalid-service-role-key',
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'gem-glow-server' } }
  }
);

const CHILD_COOKIE = 'gga_child_session';
const CHILD_SESSION_SECONDS = 60 * 60 * 12;

export function sendJson(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(payload);
}

export function requireMethod(req, res, allowed) {
  const methods = Array.isArray(allowed) ? allowed : [allowed];
  if (!methods.includes(req.method)) {
    res.setHeader('Allow', methods.join(', '));
    sendJson(res, 405, { error: 'Method not allowed' });
    return false;
  }
  return true;
}

export function cleanText(value, maxLength = 255) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function normaliseLoginName(value) {
  return cleanText(value, 40).toLocaleLowerCase('en-GB');
}

export function isValidPin(pin) {
  return /^\d{4}$/.test(String(pin ?? ''));
}

export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 64);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPin(pin, encoded) {
  try {
    const [scheme, saltPart, hashPart] = String(encoded || '').split('$');
    if (scheme !== 'scrypt' || !saltPart || !hashPart) return false;
    const expected = Buffer.from(hashPart, 'base64url');
    const actual = crypto.scryptSync(String(pin), Buffer.from(saltPart, 'base64url'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function getChildSecret() {
  const secret = process.env.CHILD_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('CHILD_SESSION_SECRET must be configured with at least 32 characters.');
  }
  return secret;
}

function signPart(value) {
  return crypto.createHmac('sha256', getChildSecret()).update(value).digest('base64url');
}

export function createChildSessionToken({ childId, parentUserId, sessionVersion }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    child_id: childId,
    parent_user_id: parentUserId,
    sv: Number(sessionVersion || 1),
    iat: now,
    exp: now + CHILD_SESSION_SECONDS,
    nonce: crypto.randomBytes(8).toString('base64url')
  })).toString('base64url');
  return `${payload}.${signPart(payload)}`;
}

export function verifyChildSessionToken(token) {
  try {
    const [payloadPart, signature] = String(token || '').split('.');
    if (!payloadPart || !signature) return null;
    const expected = signPart(payloadPart);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    if (payload.v !== 1 || !payload.child_id || !payload.parent_user_id || !Number.isInteger(payload.sv)) return null;
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((out, part) => {
    const index = part.indexOf('=');
    if (index < 0) return out;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
    return out;
  }, {});
}

export function getChildSession(req) {
  return verifyChildSessionToken(parseCookies(req)[CHILD_COOKIE]);
}

export function setChildSessionCookie(res, token) {
  const secure = /^https:\/\//i.test(process.env.APP_URL || '') || process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  const cookie = [
    `${CHILD_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${CHILD_SESSION_SECONDS}`,
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; ');
  res.setHeader('Set-Cookie', cookie);
}

export function clearChildSessionCookie(res) {
  const secure = /^https:\/\//i.test(process.env.APP_URL || '') || process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  const cookie = [
    `${CHILD_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; ');
  res.setHeader('Set-Cookie', cookie);
}

export async function verifyParentRequest(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return { user: data.user, token };
}

export async function getSubscriptionAccess(parentUserId) {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('status,current_period_end,price_id,plan_code,stripe_customer_id,stripe_subscription_id')
    .eq('user_id', parentUserId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return { active: false, status: 'none', billingIssue: false, subscription: null };
  }

  const end = data.current_period_end ? new Date(data.current_period_end).getTime() : null;
  const notExpired = !end || end > Date.now();
  const fullyActive = ['active', 'trialing'].includes(data.status) && notExpired;
  const graceAccess = data.status === 'past_due' && notExpired;

  return {
    active: fullyActive || graceAccess,
    status: data.status,
    billingIssue: graceAccess,
    subscription: data
  };
}

function randomFamilyCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let i = 0; i < 8; i += 1) {
    value += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return value;
}

export async function getOrCreateParentProfile(user) {
  const { data: existing, error: readError } = await supabaseAdmin
    .from('parent_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const familyCode = randomFamilyCode();
    const { data, error } = await supabaseAdmin
      .from('parent_profiles')
      .insert({
        user_id: user.id,
        email: user.email,
        display_name: cleanText(user.user_metadata?.full_name || '', 80) || null,
        family_code: familyCode
      })
      .select('*')
      .single();
    if (!error) return data;
    if (error.code !== '23505') throw error;
  }
  throw new Error('Unable to generate a unique family code.');
}

export async function requireActiveChild(req) {
  const session = getChildSession(req);
  if (!session) return { error: 'child_session_required', status: 401 };

  const { data: child, error } = await supabaseAdmin
    .from('child_profiles')
    .select('id,parent_user_id,display_name,avatar_key,age_band,status')
    .eq('id', session.child_id)
    .eq('parent_user_id', session.parent_user_id)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  if (!child) return { error: 'child_session_invalid', status: 401 };

  const { data: credential, error: credentialError } = await supabaseAdmin
    .from('child_credentials')
    .select('session_version')
    .eq('child_id', child.id)
    .maybeSingle();
  if (credentialError) throw credentialError;
  if (!credential || Number(credential.session_version) !== Number(session.sv)) {
    return { error: 'child_session_invalid', status: 401 };
  }

  const access = await getSubscriptionAccess(child.parent_user_id);
  if (!access.active) {
    return { error: 'membership_required', status: 402, child, access };
  }
  return { child, access, session };
}

export function requestFingerprint(req, values = []) {
  const ip = cleanText(
    String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0],
    80
  );
  return crypto
    .createHash('sha256')
    .update([ip, ...values.map(v => cleanText(v, 120))].join('|'))
    .digest('hex');
}
