/**
 * seed-alerts.ts — One-time 30-day backfill from rocketalert.live API
 *
 * Run manually: npx tsx scripts/seed-alerts.ts
 *
 * This fetches the last 30 days of alert history and loads it into Supabase.
 * Safe to re-run — uses upsert with conflict resolution.
 */
import { db } from './db';
import { mapCityToRegion } from './region-mapper';

const ROCKETALERT_BASE = 'https://agg.rocketalert.live/api';

// Same area mapping as fetch-alerts.ts
const AREA_TO_REGION: Record<string, string> = {
  'דן': 'gush-dan', 'ירקון': 'gush-dan',
  'שרון': 'sharon',
  'השפלה': 'shfela', 'שפלת יהודה': 'shfela', 'לכיש': 'shfela', 'מערב לכיש': 'shfela',
  'דרום הנגב': 'negev', 'מערב הנגב': 'negev', 'מרכז הנגב': 'negev',
  'הכרמל': 'haifa', 'המפרץ': 'haifa', 'מנשה': 'haifa', 'ואדי ערה': 'haifa',
  'גליל עליון': 'galilee', 'גליל תחתון': 'galilee', 'מרכז הגליל': 'galilee',
  'העמקים': 'galilee', 'קו העימות': 'galilee', 'צפון הגולן': 'galilee',
  'דרום הגולן': 'galilee', 'בקעת בית שאן': 'galilee',
  'ירושלים': 'jerusalem',
  'עוטף עזה': 'gaza-envelope',
  'שומרון': 'judea-samaria', 'יהודה': 'judea-samaria', 'בקעה': 'judea-samaria',
  'ים המלח': 'eilat-arava', 'אילת': 'eilat-arava', 'ערבה': 'eilat-arava',
};

function resolveRegion(areaNameHe: string | undefined, cityName: string): string | null {
  if (areaNameHe) {
    const fromArea = AREA_TO_REGION[areaNameHe.trim()];
    if (fromArea) return fromArea;
  }
  return mapCityToRegion(cityName);
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function seed() {
  const now = new Date();
  // Start from the current conflict (Iran war) — October 2025
  const CURRENT_CONFLICT_START = new Date('2025-10-01T00:00:00+02:00');

  console.log(`[${now.toISOString()}] Seeding alerts from ${formatDate(CURRENT_CONFLICT_START)} to ${formatDate(now)}...`);

  // Fetch in 5-day chunks to avoid oversized responses
  const CHUNK_DAYS = 5;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalAlerts = 0;
  const unmappedAreas = new Set<string>();

  let chunkStart = new Date(CURRENT_CONFLICT_START);

  while (chunkStart < now) {
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + CHUNK_DAYS * 24 * 60 * 60 * 1000, now.getTime()));
    const fromDate = formatDate(chunkStart);
    const toDate = formatDate(chunkEnd);

    console.log(`\n--- Fetching ${fromDate} to ${toDate} ---`);

    try {
      const url = `${ROCKETALERT_BASE}/v1/alerts/details?from=${fromDate}&to=${toDate}`;
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        console.error(`API returned ${response.status} for ${fromDate}-${toDate}`);
        chunkStart = chunkEnd;
        continue;
      }

      const data = await response.json();
      if (!data.success || !Array.isArray(data.payload)) {
        console.error(`Invalid response for ${fromDate}-${toDate}`);
        chunkStart = chunkEnd;
        continue;
      }

      const rows: Array<{
        city_name: string;
        region_slug: string;
        alert_datetime: string;
        category: string;
        raw_data: unknown;
      }> = [];

      for (const day of data.payload) {
        totalAlerts += day.alerts.length;

        for (const alert of day.alerts) {
          const cityName = alert.name?.trim();
          if (!cityName) continue;

          const regionSlug = resolveRegion(alert.areaNameHe, cityName);

          if (!regionSlug) {
            totalSkipped++;
            if (alert.areaNameHe) unmappedAreas.add(alert.areaNameHe);
            continue;
          }

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

      console.log(`  ${data.payload.length} days, ${rows.length} mappable alerts`);

      // Batch upsert
      const BATCH_SIZE = 200;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error } = await db.from('alerts').upsert(batch, {
          onConflict: 'city_name,alert_datetime',
          ignoreDuplicates: false,
        });
        if (error) {
          console.error(`  Batch error:`, error.message);
        } else {
          totalInserted += batch.length;
        }
      }
    } catch (error) {
      console.error(`  Fetch error for ${fromDate}-${toDate}:`, error);
    }

    chunkStart = chunkEnd;

    // Small delay to be nice to the API
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n=== Seed complete ===`);
  console.log(`Total API alerts: ${totalAlerts}`);
  console.log(`Inserted/updated: ${totalInserted}`);
  console.log(`Skipped (no mapping): ${totalSkipped}`);

  if (unmappedAreas.size > 0) {
    console.log(`\nUnmapped areas (add to AREA_TO_REGION):`);
    for (const area of [...unmappedAreas].sort()) {
      console.log(`  - ${area}`);
    }
  }
}

seed();
