/**
 * Shared DodoPayments Config
 *
 * ALL config is read from Supabase `dodo_config` table.
 * Nothing comes from Vercel env vars (except SUPABASE_* to connect).
 *
 * Supabase rows needed:
 *   dodo_api_key         – single key, works for both test & live endpoints
 *   dodo_env             – 'test' or 'live'
 *   dodo_product_id_test  – product ID for test mode
 *   dodo_product_id_live  – product ID for live mode
 *
 * Admin panel writes here → instant switch, no redeploy.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const BASE_URLS = {
  test: 'https://test.dodopayments.com',
  live: 'https://live.dodopayments.com',
};

// Cache: { data, expiry }
let configCache = null;
const CACHE_TTL_MS = 0;

// Call this to force next getConfig() to re-read from Supabase
function clearCache() {
  configCache = null;
}

// Read all config from Supabase at once (single round-trip)
async function readAllFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[Config] Missing SUPABASE_URL or SERVICE_ROLE_KEY');
    return null;
  }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dodo_config?select=key,value`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const config = {};
    for (const row of rows) {
      config[row.key] = row.value;
    }
    return config;
  } catch (err) {
    console.error('[Config] Supabase batch read error:', err.message);
    return null;
  }
}

async function getConfig() {
  const now = Date.now();
  if (configCache && configCache.expiry > now) return configCache.data;

  const dbConfig = await readAllFromSupabase();

  // Defaults if Supabase is unavailable
  const env       = dbConfig?.dodo_env || 'live';
  const apiKey    = dbConfig?.dodo_api_key || '';
  const productId = dbConfig?.[`dodo_product_id_${env}`] || '';

  const config = {
    env,
    baseUrl:   BASE_URLS[env],
    apiKey,
    productId,
  };

  configCache = { data: config, expiry: now + CACHE_TTL_MS };
  return config;
}

function getConfigSync() {
  if (configCache && configCache.expiry > Date.now()) return configCache.data;
  // Sync fallback — only used during cold start before async available
  return {
    env:       'live',
    baseUrl:   BASE_URLS.live,
    apiKey:    '',
    productId: '',
  };
}

module.exports = { getConfig, getConfigSync, clearCache };
