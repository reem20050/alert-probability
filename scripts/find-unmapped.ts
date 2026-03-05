import { mapCityToRegion } from './region-mapper';

const OREF_HISTORY_URL = 'https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx';

function fmt(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

async function main() {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const url = `${OREF_HISTORY_URL}?lang=he&fromDate=${fmt(oneDayAgo)}&toDate=${fmt(now)}&mode=0`;

  console.log('Fetching oref history...');
  const res = await fetch(url, {
    headers: {
      'Referer': 'https://www.oref.org.il/',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json',
    },
  });

  const data = await res.json();
  console.log(`Total alerts: ${data.length}`);

  const relevant = (data as any[]).filter(
    (a) =>
      a.category === 1 ||
      a.category === 6 ||
      a.category_desc?.includes('ירי רקטות') ||
      a.category_desc?.includes('חדירת כלי טיס עוין')
  );
  console.log(`Relevant: ${relevant.length}`);

  const unmapped = new Set<string>();
  let mappedCount = 0;

  for (const a of relevant) {
    const city = (a.data as string).trim();
    const region = mapCityToRegion(city);
    if (!region) {
      unmapped.add(city);
    } else {
      mappedCount++;
    }
  }

  console.log(`Mapped: ${mappedCount}, Unmapped unique cities: ${unmapped.size}`);
  console.log('---UNMAPPED_START---');
  const sorted = [...unmapped].sort();
  for (const c of sorted) {
    console.log(c);
  }
  console.log('---UNMAPPED_END---');
}

main();
