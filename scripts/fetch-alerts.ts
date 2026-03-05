import { db } from './db';
import { mapCityToRegion } from './region-mapper';

const API_URL = 'https://api.tzevaadom.co.il/notifications';

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

async function fetchAlerts() {
  console.log(`[${new Date().toISOString()}] Fetching alerts from tzevaadom API...`);

  try {
    const response = await fetch(API_URL, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`Raw response type: ${typeof data}, isArray: ${Array.isArray(data)}, length: ${Array.isArray(data) ? data.length : 'N/A'}`);

    // Log raw response for debugging (API is undocumented)
    if (Array.isArray(data) && data.length > 0) {
      console.log('Sample alert structure:', JSON.stringify(data[0], null, 2));
    }

    if (!Array.isArray(data)) {
      console.log('Response is not an array, raw:', JSON.stringify(data).slice(0, 500));
      return;
    }

    if (data.length === 0) {
      console.log('No active alerts');
      return;
    }

    const alerts = data as RawAlert[];
    let insertCount = 0;
    let skipCount = 0;

    for (const alert of alerts) {
      // Skip drills
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
          ignoreDuplicates: true,
        });

        if (error) {
          console.error(`Error upserting alert for ${city}:`, error.message);
        } else {
          insertCount++;
        }
      }
    }

    console.log(`Done. Inserted: ${insertCount}, Skipped (no region): ${skipCount}`);

  } catch (error) {
    console.error('Failed to fetch alerts:', error);
    process.exit(1);
  }
}

fetchAlerts();
