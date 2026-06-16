/**
 * Shared DodoPayments Config — reads env from Supabase with in-memory cache
 *
 * Instead of process.env.DODO_ENV (which requires redeploy to change),
 * we read the current env from Supabase `dodo_config` table.
 * The admin panel writes to this table to switch test/live instantly.
 *
 * Fallback: if Supabase is unavailable, falls back to process.env.DODO_ENV.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Cache: { data, expiry }
let configCache = null;
const CACHE_TTL_MS = 30_000; // 30 seconds

// API keys from env vars (both test and live are always available)
const API_KEYS = {
  test: process.env.DODO_API_KEY_TEST || process.env.DODO_API_KEY || '',
  live: process.env.DODO_API_KEY_LIVE || '',
};

const PRODUCT_IDS = {
  test: process.env.DODO_PRODUCT_ID_TEST || process.env.DODO_PRODUCT_ID || 'pdt_0NgJpLrjYb5WyvHwo2Z5X',
  live: process.env.DODO_PRODUCT_ID_LIVE || 'pdt_0Ngn5Lx3viEHrW1dSSp0i',
};

const BASE_URLS = {
  test: 'https://test.dodopayments.com',
  live: 'https://live.dodopayments.com',
};

/**
 * Read current env from Supabase dodo_config table.
 * Returns 'test' or 'live'.
 */
async function readEnvFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return process.env.DODO_ENV === 'live' ? 'live' : 'test';
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dodo_config?key=eq.dodo_env&select=value`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!res.ok) {
      console.error('[Config] Supabase read failed:', res.status);
      return process.env.DODO_ENV === 'live' ? 'live' : 'test';
    }

    const data = await res.json();
    if (Array.isArray(data) && data.length > 0 && data[0].value) {
      const env = data[0].value;
      if (env === 'test' || env === 'live') {
        return env;
      }
    }

    return 'test'; // default
  } catch (err) {
    console.error('[Config] Supabase error:', err.message);
    return process.env.DODO_ENV === 'live' ? 'live' : 'test';
  }
}

/**
 * Get the current DodoPayments configuration.
 * Reads env from Supabase (cached for 30s) and returns the matching config.
 *
 * @returns {Promise<{env: 'test'|'live', baseUrl: string, apiKey: string, productId: string}>}
 */
async function getConfig() {
  const now = Date.now();

  if (configCache && configCache.expiry > now) {
    return configCache.data;
  }

  const env = await readEnvFromSupabase();
  const config = {
    env,
    baseUrl: BASE_URLS[env],
    apiKey: API_KEYS[env],
    productId: PRODUCT_IDS[env],
  };

  configCache = {
    data: config,
    expiry: now + CACHE_TTL_MS,
  };

  return config;
}

/**
 * Get config synchronously from cache, or fallback to process.env.
 * Use this only when you can't use async (top-level module scope).
 * Prefer getConfig() in handler functions.
 */
function getConfigSync() {
  if (configCache && configCache.expiry > Date.now()) {
    return configCache.data;
  }

  // Fallback: use process.env directly (legacy behavior)
  const env = process.env.DODO_ENV === 'live' ? 'live' : 'test';
  return {
    env,
    baseUrl: BASE_URLS[env],
    apiKey: API_KEYS[env],
    productId: PRODUCT_IDS[env],
  };
}

module.exports = { getConfig, getConfigSync };
