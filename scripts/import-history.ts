import { db } from './db';
import { mapCityToRegion } from './region-mapper';

const OREF_HISTORY_URL = 'https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx';

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

async function fetchOrefHistory(fromDate: string, toDate: string): Promise<OrefAlert[]> {
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
    console.log('Response is not an array:', JSON.stringify(data).slice(0, 200));
    return [];
  }

  return data as OrefAlert[];
}

function formatDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

async function importHistory() {
  const now = new Date();
  console.log(`[${now.toISOString()}] Importing historical alerts from oref API...`);

  // Fetch alerts - the API returns up to 3000 most recent alerts
  // Try fetching with date range for last 7 days first
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fromDate = formatDate(sevenDaysAgo);
  const toDate = formatDate(now);

  let allAlerts: OrefAlert[] = [];

  try {
    const alerts = await fetchOrefHistory(fromDate, toDate);
    console.log(`Received ${alerts.length} alerts from oref API`);
    allAlerts = alerts;
  } catch (err) {
    console.error('Failed to fetch from oref history:', err);
    process.exit(1);
  }

  if (allAlerts.length === 0) {
    console.log('No alerts returned from API');
    return;
  }

  // Log date distribution
  const dateCounts: Record<string, number> = {};
  for (const a of allAlerts) {
    dateCounts[a.date] = (dateCounts[a.date] || 0) + 1;
  }
  console.log('Date distribution:');
  for (const [date, count] of Object.entries(dateCounts).sort()) {
    console.log(`  ${date}: ${count} alerts`);
  }

  // Log category distribution
  const catCounts: Record<string, number> = {};
  for (const a of allAlerts) {
    catCounts[a.category_desc] = (catCounts[a.category_desc] || 0) + 1;
  }
  console.log('Category distribution:');
  for (const [cat, count] of Object.entries(catCounts)) {
    console.log(`  ${cat}: ${count}`);
  }

  // Filter: only real rocket/missile alerts (category 1) and hostile aircraft (category 6)
  const rocketAlerts = allAlerts.filter(a =>
    a.category === 1 || a.category === 6 ||
    a.category_desc.includes('ירי רקטות') ||
    a.category_desc.includes('חדירת כלי טיס עוין')
  );
  console.log(`Filtered to ${rocketAlerts.length} relevant alerts (rockets + hostile aircraft)`);

  // Batch insert
  const BATCH_SIZE = 200;
  let insertCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  const unmappedCities = new Set<string>();

  const rows: Array<{
    city_name: string;
    region_slug: string;
    alert_datetime: string;
    category: string;
    raw_data: unknown;
  }> = [];

  for (const alert of rocketAlerts) {
    const cityName = alert.data.trim();
    const regionSlug = mapCityToRegion(cityName);

    if (!regionSlug) {
      unmappedCities.add(cityName);
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

  console.log(`Prepared ${rows.length} rows for insert, ${skipCount} skipped (unmapped cities)`);

  if (unmappedCities.size > 0) {
    console.log(`Unmapped cities (${unmappedCities.size}):`);
    for (const city of [...unmappedCities].sort()) {
      console.log(`  "${city}"`);
    }
  }

  // Insert in batches with upsert (ignore duplicates)
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await db.from('alerts').upsert(batch, {
      onConflict: 'city_name,alert_datetime',
      ignoreDuplicates: true,
    });

    if (error) {
      console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message);
      errorCount += batch.length;
    } else {
      insertCount += batch.length;
      console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: inserted ${batch.length} rows`);
    }
  }

  console.log(`\nImport complete:`);
  console.log(`  Total from API: ${allAlerts.length}`);
  console.log(`  Relevant alerts: ${rocketAlerts.length}`);
  console.log(`  Inserted/updated: ${insertCount}`);
  console.log(`  Skipped (unmapped): ${skipCount}`);
  console.log(`  Errors: ${errorCount}`);

  // Now verify what's in the DB
  const { count } = await db.from('alerts').select('*', { count: 'exact', head: true });
  console.log(`\nTotal alerts in database: ${count}`);
}

importHistory();
