import { db } from './db';
import { mapCityToRegion } from './region-mapper';

// --- Primary: rocketalert.live aggregation API (globally accessible) ---
const ROCKETALERT_BASE = 'https://agg.rocketalert.live/api';

// --- Secondary: Tzevaadom real-time API (globally accessible, live-only) ---
const TZEVAADOM_URL = 'https://api.tzevaadom.co.il/notifications';

// Map oref area names (areaNameHe) → our 10 region slugs
const AREA_TO_REGION: Record<string, string> = {
  // Gush Dan
  'דן':             'gush-dan',
  'ירקון':          'gush-dan',

  // Sharon
  'שרון':           'sharon',

  // Shfela
  'השפלה':          'shfela',
  'שפלת יהודה':     'shfela',
  'לכיש':           'shfela',
  'מערב לכיש':      'shfela',

  // Negev
  'דרום הנגב':      'negev',
  'מערב הנגב':      'negev',
  'מרכז הנגב':      'negev',

  // Haifa
  'הכרמל':          'haifa',
  'המפרץ':          'haifa',
  'מנשה':           'haifa',
  'ואדי ערה':       'haifa',

  // Galilee
  'גליל עליון':     'galilee',
  'גליל תחתון':     'galilee',
  'מרכז הגליל':     'galilee',
  'העמקים':         'galilee',
  'קו העימות':      'galilee',
  'צפון הגולן':     'galilee',
  'דרום הגולן':     'galilee',
  'בקעת בית שאן':   'galilee',

  // Jerusalem
  'ירושלים':        'jerusalem',

  // Gaza Envelope
  'עוטף עזה':       'gaza-envelope',

  // Judea & Samaria
  'שומרון':         'judea-samaria',
  'יהודה':          'judea-samaria',
  'בקעה':           'judea-samaria',

  // Eilat & Arava
  'ים המלח':        'eilat-arava',
  'אילת':           'eilat-arava',
  'ערבה':           'eilat-arava',
};

interface RocketAlertResponse {
  success: boolean;
  payload: Array<{
    date: string;
    alerts: Array<{
      name: string;
      englishName?: string;
      lat?: number;
      lon?: number;
      taCityId?: number;
      alertTypeId?: number;
      countdownSec?: number;
      areaNameHe?: string;
      areaNameEn?: string;
      timeStamp: string;
    }>;
  }>;
}

interface TzevaadomAlert {
  type?: number;
  alertDate?: string;
  isDrill?: boolean;
  data?: {
    cities?: string[];
    threat?: number;
  };
  [key: string]: unknown;
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Resolve region slug from an alert — tries area name first, then city name fallback.
 */
function resolveRegion(areaNameHe: string | undefined, cityName: string): string | null {
  // 1. Fast area-level lookup
  if (areaNameHe) {
    const fromArea = AREA_TO_REGION[areaNameHe.trim()];
    if (fromArea) return fromArea;
  }

  // 2. Fallback to city-level mapping (region-mapper.ts)
  return mapCityToRegion(cityName);
}

/**
 * Step 1 (PRIMARY): Fetch alerts from rocketalert.live aggregation API
 * This API is globally accessible and has historical data.
 * We fetch the last 2 days to catch any missed alerts.
 */
async function fetchFromRocketAlert(): Promise<number> {
  console.log('--- RocketAlert.live history (primary source) ---');
  try {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const fromDate = formatDate(twoDaysAgo);
    const toDate = formatDate(now);

    const url = `${ROCKETALERT_BASE}/v1/alerts/details?from=${fromDate}&to=${toDate}`;
    console.log(`Fetching: ${url}`);

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`rocketalert API returned ${response.status}: ${response.statusText}`);
    }

    const data: RocketAlertResponse = await response.json();

    if (!data.success || !Array.isArray(data.payload)) {
      console.log('RocketAlert response invalid:', JSON.stringify(data).slice(0, 300));
      return 0;
    }

    // Flatten all alerts from all days
    let totalAlerts = 0;
    const rows: Array<{
      city_name: string;
      region_slug: string;
      alert_datetime: string;
      category: string;
      raw_data: unknown;
    }> = [];
    let skipCount = 0;

    for (const day of data.payload) {
      totalAlerts += day.alerts.length;

      for (const alert of day.alerts) {
        const cityName = alert.name.trim();
        const regionSlug = resolveRegion(alert.areaNameHe, cityName);

        if (!regionSlug) {
          skipCount++;
          continue;
        }

        // Convert "2026-03-04 16:11:28" → ISO 8601
        const alertDatetime = alert.timeStamp.replace(' ', 'T') + '+02:00';

        rows.push({
          city_name: cityName,
          region_slug: regionSlug,
          alert_datetime: alertDatetime,
          category: alert.alertTypeId === 1 ? 'ירי רקטות וטילים'
            : alert.alertTypeId === 6 ? 'חדירת כלי טיס עוין'
            : `type_${alert.alertTypeId ?? 'unknown'}`,
          raw_data: alert,
        });
      }
    }

    console.log(`Total alerts from API: ${totalAlerts}, mapped: ${rows.length}, skipped: ${skipCount}`);

    if (rows.length === 0) {
      console.log('No mappable alerts from rocketalert');
      return 0;
    }

    // Batch upsert in chunks of 200
    const BATCH_SIZE = 200;
    let insertCount = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await db.from('alerts').upsert(batch, {
        onConflict: 'city_name,alert_datetime',
        ignoreDuplicates: false,
      });
      if (error) {
        console.error(`RocketAlert batch ${i / BATCH_SIZE + 1} error:`, error.message);
      } else {
        insertCount += batch.length;
      }
    }

    console.log(`RocketAlert: inserted/updated ${insertCount} alerts`);
    return insertCount;
  } catch (error) {
    console.error('RocketAlert fetch failed:', error);
    return 0;
  }
}

/**
 * Step 2 (SECONDARY): Fetch live alerts from tzevaadom
 * This only returns data during ACTIVE alerts — returns [] otherwise.
 * Useful as a near-real-time supplement to the history source.
 */
async function fetchFromTzevaadom(): Promise<number> {
  console.log('--- Tzevaadom real-time (secondary) ---');
  try {
    const response = await fetch(TZEVAADOM_URL, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Tzevaadom API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      console.log('No active alerts from tzevaadom (expected when quiet)');
      return 0;
    }

    console.log(`Tzevaadom: ${data.length} active alerts`);

    const alerts = data as TzevaadomAlert[];
    let insertCount = 0;
    let skipCount = 0;

    for (const alert of alerts) {
      if (alert.isDrill) continue;

      const cities = alert.data?.cities ?? [];
      const alertDate = alert.alertDate ?? new Date().toISOString();
      const category = alert.data?.threat?.toString() ?? 'unknown';

      for (const city of cities) {
        const regionSlug = mapCityToRegion(city);
        if (!regionSlug) {
          skipCount++;
          continue;
        }

        const { error } = await db.from('alerts').upsert({
          city_name: city,
          region_slug: regionSlug,
          alert_datetime: alertDate,
          category,
          raw_data: alert,
        }, {
          onConflict: 'city_name,alert_datetime',
          ignoreDuplicates: false,
        });

        if (error) {
          console.error(`Tzevaadom upsert ${city}:`, error.message);
        } else {
          insertCount++;
        }
      }
    }

    console.log(`Tzevaadom: inserted ${insertCount}, skipped ${skipCount}`);
    return insertCount;
  } catch (error) {
    // Tzevaadom failure is non-fatal — rocketalert is the primary source
    console.error('Tzevaadom fetch failed (non-fatal):', error);
    return 0;
  }
}

/**
 * Step 3 (CACHED REAL-TIME): Check rocketalert v2 cached endpoint
 * for very recent alerts that might not yet be in the v1 history.
 */
async function fetchRealTimeCached(): Promise<number> {
  console.log('--- RocketAlert real-time cached ---');
  try {
    const response = await fetch(`${ROCKETALERT_BASE}/v2/alerts/real-time/cached`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`cached endpoint returned ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      console.log('No cached real-time alerts');
      return 0;
    }

    console.log(`Cached real-time: ${data.length} alerts`);

    let insertCount = 0;
    for (const alert of data) {
      const cityName = (alert.name || alert.data || '').trim();
      if (!cityName) continue;

      const regionSlug = resolveRegion(alert.areaNameHe, cityName);
      if (!regionSlug) continue;

      const alertDatetime = alert.timeStamp
        ? alert.timeStamp.replace(' ', 'T') + '+02:00'
        : new Date().toISOString();

      const { error } = await db.from('alerts').upsert({
        city_name: cityName,
        region_slug: regionSlug,
        alert_datetime: alertDatetime,
        category: 'real-time',
        raw_data: alert,
      }, {
        onConflict: 'city_name,alert_datetime',
        ignoreDuplicates: false,
      });

      if (!error) insertCount++;
    }

    console.log(`Cached real-time: inserted ${insertCount}`);
    return insertCount;
  } catch (error) {
    console.error('Cached real-time fetch failed (non-fatal):', error);
    return 0;
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Fetch alerts pipeline starting...`);

  // Run all three sources
  const rocketAlertCount = await fetchFromRocketAlert();
  const tzevaadomCount = await fetchFromTzevaadom();
  const cachedCount = await fetchRealTimeCached();

  const total = rocketAlertCount + tzevaadomCount + cachedCount;
  console.log(`\nPipeline complete. RocketAlert: ${rocketAlertCount}, Tzevaadom: ${tzevaadomCount}, Cached: ${cachedCount} (Total: ${total})`);

  if (total === 0) {
    console.log('Warning: no alerts ingested from any source');
  }
}

main();
