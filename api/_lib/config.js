/**
 * Shared DodoPayments Config
 *
 * Dodo Payments uses the SAME API key for test and live.
 * Only the base URL changes:
 *   test → https://test.dodopayments.com
 *   live  → https://live.dodopayments.com
 *
 * Env is read from Supabase `dodo_config` table (key='dodo_env').
 * Admin panel writes here → instant switch, no redeploy.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Single API key for BOTH environments — Dodo does NOT have separate test/live keys
const API_KEY =
  process.env.DODO_API_KEY_LIVE ||
  process.env.DODO_API_KEY ||
  '';

const PRODUCT_IDS = {
  test: process.env.DODO_PRODUCT_ID_TEST || 'pdt_0NgJpLrjYb5WyvHwo2Z5X',
  live: process.env.DODO_PRODUCT_ID_LIVE || 'pdt_0Ngn5Lx3viEHrW1dSSp0i',
};

const BASE_URLS = {
  test: 'https://test.dodopayments.com',
  live: 'https://live.dodopayments.com',
};

// Cache: { data, expiry }
let configCache = null;
const CACHE_TTL_MS = 30_000;

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
      if (env === 'test' || env === 'live') return env;
    }
    return 'test';
  } catch (err) {
    console.error('[Config] Supabase error:', err.message);
    return process.env.DODO_ENV === 'live' ? 'live' : 'test';
  }
}

async function getConfig() {
  const now = Date.now();
  if (configCache && configCache.expiry > now) return configCache.data;

  const env = await readEnvFromSupabase();
  const config = {
    env,
    baseUrl: BASE_URLS[env],
    apiKey: API_KEY, // ← same key for BOTH test and live
    productId: PRODUCT_IDS[env],
  };

  configCache = { data: config, expiry: now + CACHE_TTL_MS };
  return config;
}

function getConfigSync() {
  if (configCache && configCache.expiry > Date.now()) return configCache.data;
  const env = process.env.DODO_ENV === 'live' ? 'live' : 'test';
  return {
    env,
    baseUrl: BASE_URLS[env],
    apiKey: API_KEY,
    productId: PRODUCT_IDS[env],
  };
}

module.exports = { getConfig, getConfigSync };
