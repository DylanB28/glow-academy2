// Shared application configuration. Financial and entitlement values are server controlled.
const FREE_ACTIVITY_COMPLETIONS = 3;
const ACTIVITY_COMPLETION_KEY = 'gga_preview_activity_completions';
const ACTIVITY_COMPLETION_TIMESTAMP_KEY = 'gga_preview_activity_timestamp';
const RESET_TIMEOUT_MS = 86400000;

// These are encouragement markers only. Palace items are purchased continuously from the 100-item shop.
const GEM_MILESTONES = [
  { gems: 20,  reward: 'First Palace Pick', icon: '🪴' },
  { gems: 75,  reward: 'Room Refresh',       icon: '🛋️' },
  { gems: 150, reward: 'Royal Collection',   icon: '👑' }
];
const SOUND_DURATION_MS = 7 * 60 * 1000;
