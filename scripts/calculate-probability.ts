import { db } from './db';

const REGIONS = [
  'gush-dan', 'sharon', 'shfela', 'negev', 'haifa',
  'galilee', 'jerusalem', 'gaza-envelope', 'judea-samaria', 'eilat-arava'
];

const WEIGHTS = { frequency: 0.35, recency: 0.30, timePattern: 0.20, trend: 0.15 };
const RECENCY_HALF_LIFE_MS = 6 * 60 * 60 * 1000;

async function calculateAll() {
  const now = new Date();
  console.log(`[${now.toISOString()}] Calculating probabilities...`);

  // Fetch all alerts from last 7 days
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const { data: alerts, error } = await db
    .from('alerts')
    .select('*')
    .gte('alert_datetime', sevenDaysAgo.toISOString())
    .order('alert_datetime', { ascending: false });

  if (error) {
    console.error('Failed to fetch alerts:', error.message);
    process.exit(1);
  }

  console.log(`Found ${alerts?.length ?? 0} alerts in last 7 days`);

  const snapshots = [];

  for (const regionSlug of REGIONS) {
    const regionAlerts = (alerts ?? []).filter((a: any) => a.region_slug === regionSlug);

    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

    const alertsLast24h = regionAlerts.filter((a: any) => new Date(a.alert_datetime) >= oneDayAgo);
    const alertsLast7d = regionAlerts;
    const alertsLast2d = regionAlerts.filter((a: any) => new Date(a.alert_datetime) >= twoDaysAgo);
    const alertsDays3to7 = alertsLast7d.filter((a: any) => new Date(a.alert_datetime) < twoDaysAgo);

    const hasActiveAlert = regionAlerts.some((a: any) => new Date(a.alert_datetime) >= fiveMinAgo);

    if (hasActiveAlert) {
      snapshots.push({
        region_slug: regionSlug,
        calculated_at: now.toISOString(),
        probability_score: 100,
        alert_count_24h: alertsLast24h.length,
        alert_count_7d: alertsLast7d.length,
        trend_direction: 'rising',
        has_active_alert: true,
      });
      continue;
    }

    // Frequency score: ratio of 15-min windows with alerts over 7 days
    const totalWindows = 7 * 24 * 4; // 672 possible windows
    const windows = new Set<string>();
    for (const a of alertsLast7d) {
      const d = new Date((a as any).alert_datetime);
      windows.add(`${d.toISOString().split('T')[0]}-${d.getHours()}-${Math.floor(d.getMinutes() / 15)}`);
    }
    const frequencyScore = Math.min(100, Math.log1p((windows.size / totalWindows) * 100) * 30);

    // Recency score: exponential decay based on most recent alert
    let recencyScore = 0;
    if (alertsLast7d.length > 0) {
      const mostRecent = Math.max(...alertsLast7d.map((a: any) => new Date(a.alert_datetime).getTime()));
      recencyScore = 100 * Math.exp(-0.693 * (now.getTime() - mostRecent) / RECENCY_HALF_LIFE_MS);
    }

    // Time pattern score: alerts at similar time of day
    const currentHour = now.getHours();
    const hourWindow = [currentHour - 1, currentHour, currentHour + 1].map(h => ((h % 24) + 24) % 24);
    const timePatternScore = Math.min(100, alertsLast7d.filter(
      (a: any) => hourWindow.includes(new Date(a.alert_datetime).getHours())
    ).length * 15);

    // Trend score: compare recent 2 days vs older 5 days
    let trendScore = 0;
    const recentRate = alertsLast2d.length / 2;
    const olderRate = alertsDays3to7.length / 5;
    if (olderRate > 0) {
      trendScore = Math.min(100, Math.max(0, (recentRate / olderRate) * 50));
    } else if (alertsLast2d.length > 0) {
      trendScore = 80;
    }

    let trendDirection: string = 'stable';
    if (recentRate > olderRate * 1.3) trendDirection = 'rising';
    else if (recentRate < olderRate * 0.7) trendDirection = 'falling';

    const rawScore =
      WEIGHTS.frequency * frequencyScore +
      WEIGHTS.recency * recencyScore +
      WEIGHTS.timePattern * timePatternScore +
      WEIGHTS.trend * trendScore;

    snapshots.push({
      region_slug: regionSlug,
      calculated_at: now.toISOString(),
      probability_score: Math.min(95, Math.round(rawScore)),
      alert_count_24h: alertsLast24h.length,
      alert_count_7d: alertsLast7d.length,
      trend_direction: trendDirection,
      has_active_alert: false,
    });
  }

  // Insert all snapshots
  const { error: insertError } = await db.from('probability_snapshots').insert(snapshots);

  if (insertError) {
    console.error('Failed to insert snapshots:', insertError.message);
    process.exit(1);
  }

  console.log(`Inserted ${snapshots.length} probability snapshots`);
  for (const s of snapshots) {
    console.log(`  ${s.region_slug}: ${s.probability_score}% (${s.trend_direction}, 24h: ${s.alert_count_24h}, 7d: ${s.alert_count_7d})`);
  }
}

calculateAll();
