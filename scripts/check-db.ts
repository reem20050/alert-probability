import { db } from './db';

async function check() {
  const { count } = await db.from('alerts').select('*', { count: 'exact', head: true });
  console.log('Total alerts:', count);

  const { data: oldest } = await db.from('alerts').select('alert_datetime').order('alert_datetime', { ascending: true }).limit(1);
  console.log('Oldest alert:', oldest?.[0]?.alert_datetime);

  const { data: newest } = await db.from('alerts').select('alert_datetime').order('alert_datetime', { ascending: false }).limit(1);
  console.log('Newest alert:', newest?.[0]?.alert_datetime);

  const { data: snaps } = await db.from('probability_snapshots')
    .select('region_slug, probability_score, calculated_at, alert_count_24h, alert_count_7d')
    .order('calculated_at', { ascending: false })
    .limit(10);
  console.log('\nLatest snapshots:');
  for (const s of snaps ?? []) {
    console.log(`  ${s.region_slug}: ${s.probability_score}% (24h:${s.alert_count_24h}, 7d:${s.alert_count_7d}) @ ${s.calculated_at}`);
  }

  // Count per region in last 7d
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: regionAlerts } = await db.from('alerts')
    .select('region_slug')
    .gte('alert_datetime', sevenDaysAgo);

  const counts: Record<string, number> = {};
  for (const a of regionAlerts ?? []) {
    counts[a.region_slug] = (counts[a.region_slug] || 0) + 1;
  }
  console.log('\nAlerts per region (7d):');
  for (const [r, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r}: ${c}`);
  }
}
check();
