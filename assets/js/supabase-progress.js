// Progress is stored server-side against the active child session.
const SOURCE_TO_ROOM = {
  habits: 'Emerald Eden',
  feelings: 'Sapphire Sanctuary',
  leadership: 'Ruby Rise'
};

function cacheWallet(wallet, childId = localStorage.getItem('gga_active_child_id')) {
  if (!wallet) return;
  window.GGA_WALLET = {
    gemBalance: Number(wallet.gemBalance ?? wallet.gem_balance ?? 0),
    lifetimeGems: Number(wallet.lifetimeGems ?? wallet.lifetime_gems ?? 0),
    habits: Number(wallet.habits ?? wallet.gems_habits ?? 0),
    feelings: Number(wallet.feelings ?? wallet.gems_feelings ?? 0),
    leadership: Number(wallet.leadership ?? wallet.gems_leadership ?? 0),
    streak: Number(wallet.current_streak ?? wallet.streak ?? 0)
  };
  if (childId) {
    localStorage.setItem(`gga_wallet_cache:${childId}`, JSON.stringify(window.GGA_WALLET));
  }
}

function loadCachedWallet() {
  const childId = localStorage.getItem('gga_active_child_id');
  if (!childId) return null;
  try {
    const cached = JSON.parse(localStorage.getItem(`gga_wallet_cache:${childId}`) || 'null');
    if (cached && Number.isFinite(Number(cached.gemBalance))) {
      window.GGA_WALLET = cached;
      return cached;
    }
  } catch {
    localStorage.removeItem(`gga_wallet_cache:${childId}`);
  }
  return null;
}

async function progressAwardGem(source, activityTitle, durationMinutes = 0) {
  try {
    const response = await fetch('/api/child/progress?action=complete', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: source, activityTitle, durationMinutes })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, status: response.status, reason: data.error || 'save_failed' };
    }
    cacheWallet(data.wallet);
    window.dispatchEvent(new CustomEvent('gga:wallet-updated', { detail: window.GGA_WALLET }));
    return { ok: true, awarded: data.awarded, duplicate: data.duplicate, wallet: window.GGA_WALLET };
  } catch (error) {
    console.error('[progress] activity completion failed', error);
    return { ok: false, reason: 'network_error' };
  }
}

async function progressFetch() {
  try {
    const response = await fetch('/api/child/progress?action=dashboard', {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.child?.id && window.ggaSetActiveChildId) window.ggaSetActiveChildId(data.child.id);
    cacheWallet(data.wallet, data.child?.id);
    return {
      habits: window.GGA_WALLET.habits,
      feelings: window.GGA_WALLET.feelings,
      leadership: window.GGA_WALLET.leadership,
      streak: window.GGA_WALLET.streak,
      lastActivityDate: data.wallet?.last_activity_date || null,
      gemBalance: window.GGA_WALLET.gemBalance,
      lifetimeGems: window.GGA_WALLET.lifetimeGems
    };
  } catch (error) {
    console.error('[progress] fetch failed', error);
    return null;
  }
}

// Retained as compatibility shims. Client totals are intentionally never pushed to the database.
async function progressPushGems() { return false; }
async function progressMergeGuestGems() { return false; }
async function progressPushStreak() { return false; }

window.progressAwardGem = progressAwardGem;
window.progressFetch = progressFetch;
window.progressPushGems = progressPushGems;
window.progressMergeGuestGems = progressMergeGuestGems;
window.progressPushStreak = progressPushStreak;
window.cacheWallet = cacheWallet;
window.loadCachedWallet = loadCachedWallet;
