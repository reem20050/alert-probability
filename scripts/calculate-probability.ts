import { db } from './db';

// ============================================================
// Simple Empirical Probability — v5 (event-based counting)
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
// Alert Event Deduplication
//
// Each DB row = one city alert.  A single rocket barrage
// triggers alerts across MANY cities at once.  We must NOT
// count each city — we count *events* (barrages).
//
// An "event" = a cluster of alerts separated by > 2 minutes.
// ============================================================

interface AlertRow {
  region_slug: string;
  alert_datetime: string;
}

/**
 * Group region alerts into events (barrages).
 * Alerts within a 2-minute gap are ONE event.
 * Returns sorted array of event timestamps (ms).
 */
function deduplicateIntoEvents(alerts: AlertRow[]): number[] {
  if (alerts.length === 0) return [];

  const timestamps = alerts
    .map(a => new Date(a.alert_datetime).getTime())
    .sort((a, b) => a - b);

  const events: number[] = [timestamps[0]];
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] - timestamps[i - 1] > 2 * 60_000) {
      events.push(timestamps[i]);
    }
  }
  return events;
}

/**
 * For base rate: count unique 15-min windows that had ≥1 alert.
 */
function deduplicateIntoWindows(alerts: AlertRow[]): number[] {
  if (alerts.length === 0) return [];
  const windows = new Set<number>();
  for (const a of alerts) {
    const ts = new Date(a.alert_datetime).getTime();
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
  regionEvents: number[],          // already-deduplicated event timestamps
  currentHourIsrael: number,
): number {
  if (regionEvents.length === 0) return 0.1;

  // Count events per hour (Israel time) — NOT individual city alerts
  const hourCounts = new Array(24).fill(0);
  for (const ts of regionEvents) {
    const h = getIsraelHour(ts);
    hourCounts[h]++;
  }

  const avgPerHour = regionEvents.length / 24;
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
  regionEvents: number[],          // already-deduplicated event timestamps
  nowMs: number,
): 'rising' | 'falling' | 'stable' {
  const oneDayAgo = nowMs - DAY_MS;
  const twoDaysAgo = nowMs - 2 * DAY_MS;
  const sevenDaysAgo = nowMs - 7 * DAY_MS;

  // Count EVENTS, not individual city alerts
  const eventsLast24h = regionEvents.filter(ts => ts >= oneDayAgo).length;
  const eventsDays2to7 = regionEvents.filter(
    ts => ts >= sevenDaysAgo && ts < twoDaysAgo,
  ).length;

  const recentRate = eventsLast24h; // per 1 day
  const olderRate = eventsDays2to7 / 5; // per day average over 5 days

  if (olderRate > 0) {
    if (recentRate > olderRate * 1.3) return 'rising';
    if (recentRate < olderRate * 0.7) return 'falling';
  } else if (eventsLast24h > 0) {
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

  console.log(`[${now.toISOString()}] Simple Empirical Probability v5 (event-based counting)`);
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

    // Deduplicate city alerts into events (barrages)
    // Alerts within 2 min of each other = 1 event
    const regionEvents = deduplicateIntoEvents(regionAlerts);

    // Count event-based stats (NOT per-city)
    const eventsLast24h = regionEvents.filter(ts => nowMs - ts < DAY_MS).length;
    const eventsLast7d = regionEvents.filter(ts => nowMs - ts < 7 * DAY_MS).length;
    const hasActive = regionAlerts.some(
      a => nowMs - new Date(a.alert_datetime).getTime() < 5 * 60_000,
    );

    // Override O1: Active alert → 100%
    if (hasActive) {
      snapshots.push({
        region_slug: region,
        calculated_at: now.toISOString(),
        probability_score: 100,
        alert_count_24h: eventsLast24h,
        alert_count_7d: eventsLast7d,
        trend_direction: 'rising' as const,
        has_active_alert: true,
      });
      console.log(`  ${region.padEnd(16)} 100% 🔴 ACTIVE ALERT (${regionAlerts.length} city alerts → ${regionEvents.length} events)`);
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
    const hourMult = calculateHourMultiplier(regionEvents, currentHourIsrael);
    const momentum = calculateMomentumMultiplier(regionAlerts, nowMs);
    const trend = calculateTrend(regionEvents, nowMs);

    // P = baseRate × hourMultiplier × momentumMultiplier
    let rawScore = baseRate * hourMult * momentum;

    // Override O2: Cap at 95 (no active alert)
    rawScore = Math.min(95, rawScore);

    // Override O4: Floor at 1 if attacked in last 7 days
    if (rawScore < 1 && eventsLast7d > 0) {
      rawScore = 1;
    }

    const score = Math.round(rawScore);

    snapshots.push({
      region_slug: region,
      calculated_at: now.toISOString(),
      probability_score: score,
      alert_count_24h: eventsLast24h,
      alert_count_7d: eventsLast7d,
      trend_direction: trend,
      has_active_alert: false,
    });

    // Detailed log
    console.log(
      `  ${region.padEnd(16)} ${String(score).padStart(3)}% | ` +
      `base=${baseRate.toFixed(2)}% hour×${hourMult.toFixed(2)} mom×${momentum.toFixed(1)} | ` +
      `24h:${eventsLast24h} 7d:${eventsLast7d} events:${regionEvents.length} (from ${regionAlerts.length} city alerts) | ` +
      `trend:${trend}`,
    );
  }

  // ── Insert snapshots ──
  const { error: insertErr } = await db.from('probability_snapshots').insert(snapshots);
  if (insertErr) { console.error('Insert error:', insertErr.message); process.exit(1); }

  console.log(`\nInserted ${snapshots.length} snapshots (Empirical v5 — event-based)`);

  // ── Summary ──
  const highProb = snapshots.filter(s => s.probability_score >= 50);
  const activeRegions = snapshots.filter(s => s.has_active_alert);
  console.log(`Summary: ${highProb.length} regions ≥50%, ${activeRegions.length} active alerts`);
}

calculateAll();
