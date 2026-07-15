window.GGA_PRICES = { monthly: 'monthly', annual: 'annual' };

const sb = window.supabase.createClient(
  window.TEP_SUPABASE_URL,
  window.TEP_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

window.GGA_AUTH_STATE = { role: 'guest', child: null, parent: null };

const ACTIVE_CHILD_ID_KEY = 'gga_active_child_id';
const CHILD_DISPLAY_CACHE_KEYS = [
  'gga_gem_balance', 'gga_gems_habits', 'gga_gems_feelings',
  'gga_gems_leadership', 'gga_daily_streak'
];

function clearChildDisplayCache() {
  CHILD_DISPLAY_CACHE_KEYS.forEach(key => localStorage.removeItem(key));
  delete window.GGA_WALLET;
}

function setActiveChildId(childId) {
  const next = childId ? String(childId) : '';
  const current = localStorage.getItem(ACTIVE_CHILD_ID_KEY) || '';
  if (current && next && current !== next) clearChildDisplayCache();
  if (next) localStorage.setItem(ACTIVE_CHILD_ID_KEY, next);
  else localStorage.removeItem(ACTIVE_CHILD_ID_KEY);
}

function childStorageKey(base) {
  const childId = localStorage.getItem(ACTIVE_CHILD_ID_KEY) || 'guest';
  return `${base}:${childId}`;
}

function safeLocalDestination(value, fallback = null) {
  if (!value || typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  try {
    const target = new URL(value, window.location.origin);
    return target.origin === window.location.origin
      ? `${target.pathname}${target.search}${target.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function parentAuthHeader() {
  const { data } = await sb.auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

async function getChildSession() {
  try {
    const response = await fetch('/api/child/auth?action=session', {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!response.ok) {
      if (response.status === 401) {
        setActiveChildId(null);
        clearChildDisplayCache();
      }
      return null;
    }
    const data = await response.json();
    if (data?.active && data.child?.id) setActiveChildId(data.child.id);
    return data;
  } catch {
    return null;
  }
}

async function getEntitlements() {
  const headers = await parentAuthHeader();
  try {
    return await fetchJson('/api/me/entitlements', { method: 'GET', headers });
  } catch (error) {
    console.error('[auth] entitlement check failed', error);
    return { role: 'guest', loggedIn: false, active: false, unavailable: true };
  }
}

function setAuthButton(button, { icon, label, onClick }) {
  if (!button) return;
  button.innerHTML = `<i class="fa-solid ${icon}"></i><span>${label}</span>`;
  button.onclick = onClick;
  button.style.display = 'flex';
}

async function checkLoginState() {
  const childSession = await getChildSession();
  const { data } = await sb.auth.getSession();
  const parentSession = data.session;

  const authBtn = document.getElementById('authBtn');
  const mobileBtn = document.getElementById('signOutBtnMobile');
  const palaceTab = document.getElementById('palaceTab');

  if (childSession?.active) {
    window.GGA_AUTH_STATE = {
      role: 'child',
      child: childSession.child,
      parent: parentSession?.user || null
    };
    setAuthButton(authBtn, {
      icon: 'fa-user-group',
      label: childSession.child.displayName,
      onClick: () => { window.location.href = 'child-login.html'; }
    });
    setAuthButton(mobileBtn, {
      icon: 'fa-repeat',
      label: 'Switch child',
      onClick: () => { window.location.href = 'child-login.html'; }
    });
    if (palaceTab) palaceTab.style.display = '';
    document.documentElement.dataset.userRole = 'child';
    return true;
  }

  setActiveChildId(null);
  clearChildDisplayCache();

  if (parentSession) {
    window.GGA_AUTH_STATE = { role: 'parent', child: null, parent: parentSession.user };
    setAuthButton(authBtn, {
      icon: 'fa-user-gear',
      label: 'Parent account',
      onClick: () => { window.location.href = 'profile.html'; }
    });
    setAuthButton(mobileBtn, {
      icon: 'fa-user-gear',
      label: 'Parent account',
      onClick: () => { window.location.href = 'profile.html'; }
    });
    if (palaceTab) palaceTab.style.display = 'none';
    document.documentElement.dataset.userRole = 'parent';
    return true;
  }

  window.GGA_AUTH_STATE = { role: 'guest', child: null, parent: null };
  setAuthButton(authBtn, {
    icon: 'fa-right-to-bracket',
    label: 'Parent sign in',
    onClick: () => { window.location.href = 'sign-in.html'; }
  });
  setAuthButton(mobileBtn, {
    icon: 'fa-right-to-bracket',
    label: 'Sign in',
    onClick: () => { window.location.href = 'sign-in.html'; }
  });
  if (palaceTab) palaceTab.style.display = 'none';
  document.documentElement.dataset.userRole = 'guest';
  return false;
}

async function handleSignOut() {
  const childSession = await getChildSession();
  if (childSession?.active) {
    await fetch('/api/child/auth?action=logout', { method: 'POST', credentials: 'same-origin' });
    setActiveChildId(null);
    clearChildDisplayCache();
    window.location.href = 'child-login.html';
    return;
  }
  await sb.auth.signOut({ scope: 'local' });
  setActiveChildId(null);
  clearChildDisplayCache();
  sessionStorage.clear();
  window.location.href = 'sign-in.html';
}

async function signOutAll() {
  await fetch('/api/child/auth?action=logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  await sb.auth.signOut({ scope: 'local' });
  setActiveChildId(null);
  clearChildDisplayCache();
  sessionStorage.clear();
  window.location.href = 'sign-in.html';
}

async function checkMembershipStatus() {
  const childSession = await getChildSession();
  if (childSession?.active) {
    return {
      loggedIn: true,
      isMember: true,
      role: 'child',
      child: childSession.child,
      requiresChildLogin: false,
      billingIssue: Boolean(childSession.billingIssue),
      unavailable: false
    };
  }

  const access = await getEntitlements();
  return {
    loggedIn: Boolean(access.loggedIn),
    isMember: Boolean(access.active),
    role: access.role || 'guest',
    requiresChildLogin: access.role === 'parent' && access.active,
    billingIssue: Boolean(access.billingIssue),
    unavailable: Boolean(access.unavailable)
  };
}

async function startCheckout(plan = 'monthly') {
  const validPlan = plan === 'annual' ? 'annual' : 'monthly';
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    localStorage.setItem('gga_pending_plan', validPlan);
    window.location.href = 'signup.html';
    return;
  }

  try {
    const result = await fetchJson('/api/create-checkout-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ plan: validPlan })
    });
    window.location.href = result.url;
  } catch (error) {
    if (error.data?.redirect) {
      window.location.href = error.data.redirect;
      return;
    }
    alert(error.message || 'Checkout could not be started.');
  }
}

async function openBillingPortal() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    window.location.href = 'sign-in.html';
    return;
  }
  try {
    const result = await fetchJson('/api/create-portal-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      body: '{}'
    });
    window.location.href = result.url;
  } catch (error) {
    if (error.status === 404) {
      window.location.href = 'signup.html?membership=required';
      return;
    }
    alert(error.message || 'Billing settings could not be opened.');
  }
}

async function resolveParentDestination() {
  await fetch('/api/child/auth?action=logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  setActiveChildId(null);
  clearChildDisplayCache();
  const pendingPlan = localStorage.getItem('gga_pending_plan');
  if (pendingPlan) {
    localStorage.removeItem('gga_pending_plan');
    await startCheckout(pendingPlan);
    return;
  }
  const access = await getEntitlements();
  if (!access.active) {
    window.location.href = 'signup.html?membership=required';
  } else if ((access.childrenCount || 0) === 0 || !access.profileComplete) {
    window.location.href = 'profile.html?welcome=1';
  } else {
    window.location.href = 'profile.html';
  }
}

async function protectParentPage() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`sign-in.html?next=${next}`);
    return null;
  }
  return data.session;
}

async function protectChildPage() {
  const child = await getChildSession();
  if (!child?.active) {
    window.location.replace('child-login.html');
    return null;
  }
  return child;
}

window.checkLoginState = checkLoginState;
window.handleSignOut = handleSignOut;
window.signOutAll = signOutAll;
window.checkMembershipStatus = checkMembershipStatus;
window.startCheckout = startCheckout;
window.openBillingPortal = openBillingPortal;
window.resolveParentDestination = resolveParentDestination;
window.protectParentPage = protectParentPage;
window.protectChildPage = protectChildPage;
window.getChildSession = getChildSession;
window.getEntitlements = getEntitlements;
window.parentAuthHeader = parentAuthHeader;
window.ggaFetchJson = fetchJson;
window.safeLocalDestination = safeLocalDestination;
window.ggaChildStorageKey = childStorageKey;
window.ggaSetActiveChildId = setActiveChildId;
window.ggaClearChildDisplayCache = clearChildDisplayCache;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkLoginState);
else checkLoginState();

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') checkLoginState();
});
