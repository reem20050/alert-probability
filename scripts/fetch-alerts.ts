import { db } from './db';
import { mapCityToRegion } from './region-mapper';

// --- Tzevaadom real-time API (globally accessible) ---
const TZEVAADOM_URL = 'https://api.tzevaadom.co.il/notifications';

// --- Oref history API (globally accessible AJAX endpoint) ---
const OREF_HISTORY_URL = 'https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx';

interface RawAlert {
  type?: number;
  alertDate?: string;
  isDrill?: boolean;
  data?: {
    cities?: string[];
    threat?: number;
  };
  [key: string]: unknown;
}

interface OrefAlert {
  data: string;       // city name in Hebrew
  date: string;       // DD.MM.YYYY
  time: string;       // HH:MM:SS
  alertDate: string;  // ISO 8601
  category: number;
  category_desc: string;
  matrix_id: number;
  rid: number;
}

function formatDateForOref(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

/** Step 1: Fetch live alerts from tzevaadom */
async function fetchFromTzevaadom(): Promise<number> {
  console.log('--- Tzevaadom real-time ---');
  try {
    const response = await fetch(TZEVAADOM_URL, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`Response: isArray=${Array.isArray(data)}, length=${Array.isArray(data) ? data.length : 'N/A'}`);

    if (Array.isArray(data) && data.length > 0) {
      console.log('Sample alert:', JSON.stringify(data[0], null, 2));
    }

    if (!Array.isArray(data) || data.length === 0) {
      console.log('No active alerts from tzevaadom');
      return 0;
    }

    const alerts = data as RawAlert[];
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
          console.error(`Error upserting ${city}:`, error.message);
        } else {
          insertCount++;
        }
      }
    }

    console.log(`Tzevaadom: inserted ${insertCount}, skipped ${skipCount}`);
    return insertCount;
  } catch (error) {
    console.error('Tzevaadom fetch failed:', error);
    return 0;
  }
}

/** Step 2: Backfill from oref history API (last 30 days) */
async function fetchFromOrefHistory(): Promise<number> {
  console.log('--- Oref history backfill (30 days) ---');
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fromDate = formatDateForOref(thirtyDaysAgo);
    const toDate = formatDateForOref(now);

    const url = `${OREF_HISTORY_URL}?lang=he&fromDate=${fromDate}&toDate=${toDate}&mode=0`;
    console.log(`Fetching: ${url}`);

    const response = await fetch(url, {
      headers: {
        'Referer': 'https://www.oref.org.il/',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`oref API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      console.log('Oref response not an array:', JSON.stringify(data).slice(0, 200));
      return 0;
    }

    console.log(`Received ${data.length} alerts from oref history`);

    if (data.length === 0) return 0;

    // Filter: only rockets (category 1) and hostile aircraft (category 6)
    const relevant = (data as OrefAlert[]).filter(a =>
      a.category === 1 || a.category === 6 ||
      a.category_desc?.includes('ירי רקטות') ||
      a.category_desc?.includes('חדירת כלי טיס עוין')
    );
    console.log(`Filtered to ${relevant.length} relevant alerts`);

    const BATCH_SIZE = 200;
    let insertCount = 0;
    let skipCount = 0;
    const rows: Array<{
      city_name: string;
      region_slug: string;
      alert_datetime: string;
      category: string;
      raw_data: unknown;
    }> = [];

    for (const alert of relevant) {
      const cityName = alert.data.trim();
      const regionSlug = mapCityToRegion(cityName);
      if (!regionSlug) {
        skipCount++;
        continue;
      }
      rows.push({
        city_name: cityName,
        region_slug: regionSlug,
        alert_datetime: alert.alertDate,
        category: alert.category_desc,
        raw_data: alert,
      });
    }

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await db.from('alerts').upsert(batch, {
        onConflict: 'city_name,alert_datetime',
        ignoreDuplicates: false,
      });
      if (error) {
        console.error(`Oref batch error:`, error.message);
      } else {
        insertCount += batch.length;
      }
    }

    console.log(`Oref history: inserted/updated ${insertCount}, skipped ${skipCount}`);
    return insertCount;
  } catch (error) {
    // Oref history failure is non-fatal — tzevaadom is the primary source
    console.error('Oref history fetch failed (non-fatal):', error);
    return 0;
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Fetch alerts pipeline starting...`);

  // Run both sources
  const tzevaadomCount = await fetchFromTzevaadom();
  const orefCount = await fetchFromOrefHistory();

  console.log(`\nPipeline complete. Tzevaadom: ${tzevaadomCount}, Oref: ${orefCount}`);

  // Exit with error only if BOTH sources fail
  if (tzevaadomCount === 0 && orefCount === 0) {
    console.log('Warning: no alerts ingested from either source');
  }
}

main();
