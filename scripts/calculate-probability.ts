import { db } from './db';

// ============================================================
// Simple Empirical Probability — v4
//
// P = baseRate × hourMultiplier × momentumMultiplier
//
// Three intuitive components:
// 1. Base rate:  how often does this region get alerts? (empirical %)
// 2. Hour mult:  are alerts more/less likely at this hour? (time-of-day)
// 3. Momentum:   has it been noisy or quiet recently? (recency state)
//
// No ML, no weights to tune. Pure counting and multiplication.
// ============================================================

const REGIONS = [
  'gush-dan', 'sharon', 'shfela', 'negev', 'haifa',
  'galilee', 'jerusalem', 'gaza-envelope', 'judea-samaria', 'eilat-arava',
];

// War start date — Feb 28, 2026 (Israel time, UTC+2)
const WAR_START_MS = new Date('2026-02-28T00:00:00+02:00').getTime();

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// ============================================================
// Alert Event Deduplication — 2-minute window grouping
// ============================================================

interface AlertRow {
  region_slug: string;
  alert_datetime: string;
}

function deduplicateIntoWindows(alerts: AlertRow[]): number[] {
  // Returns array of timestamps (ms), one per 15-min window that had ≥1 alert
  if (alerts.length === 0) return [];
  const windows = new Set<number>();
  for (const a of alerts) {
    const ts = new Date(a.alert_datetime).getTime();
    // Round down to 15-min window
    const windowStart = ts - (ts % (15 * 60_000));
    windows.add(windowStart);
  }
  return [...windows].sort((a, b) => a - b);
}

// ============================================================
// Israel timezone hour helper
// ============================================================

function getIsraelHour(ms: number): number {
  return parseInt(
    new Date(ms).toLocaleString('en-US', {
      timeZone: 'Asia/Jerusalem',
      hour: 'numeric',
      hour12: false,
    })
  );
}

// ============================================================
// Component 1: Base Rate (empirical frequency)
// ============================================================

function calculateBaseRate(
  windowsWithAlerts: number,
  totalWindowsSinceWarStart: number,
): number {
  if (totalWindowsSinceWarStart <= 0) return 0;
  return (windowsWithAlerts / totalWindowsSinceWarStart) * 100;
}

// ============================================================
// Component 2: Hour Multiplier (time-of-day adjustment)
// ============================================================

function calculateHourMultiplier(
  regionAlerts: AlertRow[],
  currentHourIsrael: number,
): number {
  if (regionAlerts.length === 0) return 0.1;

  // Count alerts per hour (Israel time)
  const hourCounts = new Array(24).fill(0);
  for (const a of regionAlerts) {
    const h = getIsraelHour(new Date(a.alert_datetime).getTime());
    hourCounts[h]++;
  }

  const avgPerHour = regionAlerts.length / 24;
  if (avgPerHour === 0) return 0.1;

  // Smoothed window: [h-1, h, h+1]
  const window = [
    ((currentHourIsrael - 1) % 24 + 24) % 24,
    currentHourIsrael,
    ((currentHourIsrael + 1) % 24 + 24) % 24,
  ];

  const windowAvg = window.reduce((sum, h) => sum + hourCounts[h], 0) / window.length;
  const multiplier = windowAvg / avgPerHour;

  // Floor at 0.1, cap at 3.0
  return Math.max(0.1, Math.min(3.0, multiplier));
}

// ============================================================
// Component 3: Momentum Multiplier (recent activity state)
// ============================================================

function calculateMomentumMultiplier(
  regionAlerts: AlertRow[],
  nowMs: number,
): number {
  if (regionAlerts.length === 0) return 0.2;

  // Find most recent alert
  let mostRecentMs = 0;
  for (const a of regionAlerts) {
    const ts = new Date(a.alert_datetime).getTime();
    if (ts > mostRecentMs) mostRecentMs = ts;
  }

  const hoursSince = (nowMs - mostRecentMs) / HOUR_MS;

  if (hoursSince <= 1) return 2.5;
  if (hoursSince <= 3) return 2.0;
  if (hoursSince <= 6) return 1.5;
  if (hoursSince <= 12) return 1.0;
  if (hoursSince <= 24) return 0.7;
  if (hoursSince <= 48) return 0.4;
  return 0.2;
}

// ============================================================
// Trend Direction (for display)
// ============================================================

function calculateTrend(
  regionAlerts: AlertRow[],
  nowMs: number,
): 'rising' | 'falling' | 'stable' {
  const oneDayAgo = nowMs - DAY_MS;
  const twoDaysAgo = nowMs - 2 * DAY_MS;
  const sevenDaysAgo = nowMs - 7 * DAY_MS;

  const alertsLast24h = regionAlerts.filter(
    a => new Date(a.alert_datetime).getTime() >= oneDayAgo,
  ).length;

  const alertsDays2to7 = regionAlerts.filter(a => {
    const ts = new Date(a.alert_datetime).getTime();
    return ts >= sevenDaysAgo && ts < twoDaysAgo;
  }).length;

  const recentRate = alertsLast24h; // per 1 day
  const olderRate = alertsDays2to7 / 5; // per day average over 5 days

  if (olderRate > 0) {
    if (recentRate > olderRate * 1.3) return 'rising';
    if (recentRate < olderRate * 0.7) return 'falling';
  } else if (alertsLast24h > 0) {
    return 'rising';
  }

  return 'stable';
}

// ============================================================
// Main Pipeline
// ============================================================

async function calculateAll() {
  const now = new Date();
  const nowMs = now.getTime();
  const currentHourIsrael = getIsraelHour(nowMs);

  console.log(`[${now.toISOString()}] Simple Empirical Probability v4`);
  console.log(`  Israel hour: ${currentHourIsrael}:00\n`);

  // ── Fetch ALL alerts (paginated — Supabase caps at 1000) ──
  const alerts: AlertRow[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  let fetchError: string | null = null;

  while (true) {
    const { data, error } = await db
      .from('alerts')
      .select('region_slug, alert_datetime')
      .order('alert_datetime', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) { fetchError = error.message; break; }
    if (!data || data.length === 0) break;
    alerts.push(...data);
    if (data.length < PAGE_SIZE) break; // last page
    offset += PAGE_SIZE;
  }

  if (fetchError) { console.error('DB error:', fetchError); process.exit(1); }
  if (alerts.length === 0) {
    console.log('No alerts in DB — writing zero snapshots');
    await db.from('probability_snapshots').insert(
      REGIONS.map(r => ({
        region_slug: r, calculated_at: now.toISOString(),
        probability_score: 0, alert_count_24h: 0, alert_count_7d: 0,
        trend_direction: 'stable', has_active_alert: false,
      }))
    );
    return;
  }

  console.log(`Loaded ${alerts.length} alerts`);

  // ── Total 15-min windows since war start ──
  const hoursSinceWarStart = (nowMs - WAR_START_MS) / HOUR_MS;
  const totalWindowsSinceWarStart = Math.floor(hoursSinceWarStart * 4); // 4 windows per hour
  console.log(`War started ${(hoursSinceWarStart / 24).toFixed(1)} days ago (${totalWindowsSinceWarStart} windows)\n`);

  // ── Group alerts by region ──
  const alertsByRegion: Record<string, AlertRow[]> = {};
  for (const r of REGIONS) alertsByRegion[r] = [];
  for (const a of alerts) {
    if (alertsByRegion[a.region_slug]) alertsByRegion[a.region_slug].push(a);
  }

  // ── Calculate per region ──
  const snapshots = [];

  for (const region of REGIONS) {
    const regionAlerts = alertsByRegion[region];

    // Count stats
    const alertsLast24h = regionAlerts.filter(
      a => nowMs - new Date(a.alert_datetime).getTime() < DAY_MS,
    );
    const alertsLast7d = regionAlerts.filter(
      a => nowMs - new Date(a.alert_datetime).getTime() < 7 * DAY_MS,
    );
    const hasActive = regionAlerts.some(
      a => nowMs - new Date(a.alert_datetime).getTime() < 5 * 60_000,
    );

    // Override O1: Active alert → 100%
    if (hasActive) {
      snapshots.push({
        region_slug: region,
        calculated_at: now.toISOString(),
        probability_score: 100,
        alert_count_24h: alertsLast24h.length,
        alert_count_7d: alertsLast7d.length,
        trend_direction: 'rising' as const,
        has_active_alert: true,
      });
      console.log(`  ${region.padEnd(16)} 100% 🔴 ACTIVE ALERT`);
      continue;
    }

    // Override O3: Never attacked → 0%
    if (regionAlerts.length === 0) {
      snapshots.push({
        region_slug: region,
        calculated_at: now.toISOString(),
        probability_score: 0,
        alert_count_24h: 0,
        alert_count_7d: 0,
        trend_direction: 'stable' as const,
        has_active_alert: false,
      });
      console.log(`  ${region.padEnd(16)}   0% ⚪ never attacked`);
      continue;
    }

    // ── Calculate 3 components ──
    const windows = deduplicateIntoWindows(regionAlerts);
    const baseRate = calculateBaseRate(windows.length, totalWindowsSinceWarStart);
    const hourMult = calculateHourMultiplier(regionAlerts, currentHourIsrael);
    const momentum = calculateMomentumMultiplier(regionAlerts, nowMs);
    const trend = calculateTrend(regionAlerts, nowMs);

    // P = baseRate × hourMultiplier × momentumMultiplier
    let rawScore = baseRate * hourMult * momentum;

    // Override O2: Cap at 95 (no active alert)
    rawScore = Math.min(95, rawScore);

    // Override O4: Floor at 1 if attacked in last 7 days
    if (rawScore < 1 && alertsLast7d.length > 0) {
      rawScore = 1;
    }

    const score = Math.round(rawScore);

    snapshots.push({
      region_slug: region,
      calculated_at: now.toISOString(),
      probability_score: score,
      alert_count_24h: alertsLast24h.length,
      alert_count_7d: alertsLast7d.length,
      trend_direction: trend,
      has_active_alert: false,
    });

    // Detailed log
    console.log(
      `  ${region.padEnd(16)} ${String(score).padStart(3)}% | ` +
      `base=${baseRate.toFixed(2)}% hour×${hourMult.toFixed(2)} mom×${momentum.toFixed(1)} | ` +
      `24h:${alertsLast24h.length} 7d:${alertsLast7d.length} windows:${windows.length} | ` +
      `trend:${trend}`,
    );
  }

  // ── Insert snapshots ──
  const { error: insertErr } = await db.from('probability_snapshots').insert(snapshots);
  if (insertErr) { console.error('Insert error:', insertErr.message); process.exit(1); }

  console.log(`\nInserted ${snapshots.length} snapshots (Empirical v4)`);

  // ── Summary ──
  const highProb = snapshots.filter(s => s.probability_score >= 50);
  const activeRegions = snapshots.filter(s => s.has_active_alert);
  console.log(`Summary: ${highProb.length} regions ≥50%, ${activeRegions.length} active alerts`);
}

calculateAll();
