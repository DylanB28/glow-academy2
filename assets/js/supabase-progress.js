// Progress is stored server-side against the active child session.
const SOURCE_TO_ROOM = {
  habits: 'Emerald Eden',
  feelings: 'Sapphire Sanctuary',
  leadership: 'Ruby Rise'
};

function cacheWallet(wallet) {
  if (!wallet) return;
  window.GGA_WALLET = {
    gemBalance: Number(wallet.gemBalance ?? wallet.gem_balance ?? 0),
    lifetimeGems: Number(wallet.lifetimeGems ?? wallet.lifetime_gems ?? 0),
    habits: Number(wallet.habits ?? wallet.gems_habits ?? 0),
    feelings: Number(wallet.feelings ?? wallet.gems_feelings ?? 0),
    leadership: Number(wallet.leadership ?? wallet.gems_leadership ?? 0),
    streak: Number(wallet.current_streak ?? wallet.streak ?? 0)
  };
  // Display cache only. Purchases and awards never trust these values.
  localStorage.setItem('gga_gem_balance', String(window.GGA_WALLET.gemBalance));
  localStorage.setItem('gga_gems_habits', String(window.GGA_WALLET.habits));
  localStorage.setItem('gga_gems_feelings', String(window.GGA_WALLET.feelings));
  localStorage.setItem('gga_gems_leadership', String(window.GGA_WALLET.leadership));
  localStorage.setItem('gga_daily_streak', String(window.GGA_WALLET.streak));
}

async function progressAwardGem(source, activityTitle, durationMinutes = 0) {
  try {
    const response = await fetch('/api/child/complete-activity', {
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
    const response = await fetch('/api/child/dashboard', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    cacheWallet(data.wallet);
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
