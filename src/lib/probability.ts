import type { Alert, ProbabilitySnapshot } from '@/types';

// ============================================================
// Simple Empirical Probability — SSR fallback
//
// Same algorithm as scripts/calculate-probability.ts (v4)
// P = baseRate × hourMultiplier × momentumMultiplier
// ============================================================

interface ProbabilityInput {
  regionSlug: string;
  alerts: Alert[];
  now?: Date;
}

// War start date — Feb 28, 2026 (Israel time, UTC+2)
const WAR_START_MS = new Date('2026-02-28T00:00:00+02:00').getTime();

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function getIsraelHour(ms: number): number {
  return parseInt(
    new Date(ms).toLocaleString('en-US', {
      timeZone: 'Asia/Jerusalem',
      hour: 'numeric',
      hour12: false,
    })
  );
}

function countUniqueWindows(alerts: Alert[]): number {
  const windows = new Set<number>();
  for (const a of alerts) {
    const ts = new Date(a.alert_datetime).getTime();
    const windowStart = ts - (ts % (15 * 60_000));
    windows.add(windowStart);
  }
  return windows.size;
}

function calculateHourMultiplier(
  alerts: Alert[],
  currentHourIsrael: number,
): number {
  if (alerts.length === 0) return 0.1;

  const hourCounts = new Array(24).fill(0);
  for (const a of alerts) {
    const h = getIsraelHour(new Date(a.alert_datetime).getTime());
    hourCounts[h]++;
  }

  const avgPerHour = alerts.length / 24;
  if (avgPerHour === 0) return 0.1;

  const window = [
    ((currentHourIsrael - 1) % 24 + 24) % 24,
    currentHourIsrael,
    ((currentHourIsrael + 1) % 24 + 24) % 24,
  ];

  const windowAvg = window.reduce((sum, h) => sum + hourCounts[h], 0) / window.length;
  const multiplier = windowAvg / avgPerHour;

  return Math.max(0.1, Math.min(3.0, multiplier));
}

function calculateMomentumMultiplier(
  alerts: Alert[],
  nowMs: number,
): number {
  if (alerts.length === 0) return 0.2;

  let mostRecentMs = 0;
  for (const a of alerts) {
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

export function calculateProbability(input: ProbabilityInput): Omit<ProbabilitySnapshot, 'id'> {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const alerts = input.alerts.filter(a => a.region_slug === input.regionSlug);

  const oneDayAgo = new Date(nowMs - DAY_MS);
  const sevenDaysAgo = new Date(nowMs - 7 * DAY_MS);
  const twoDaysAgo = new Date(nowMs - 2 * DAY_MS);

  const alertsLast24h = alerts.filter(a => new Date(a.alert_datetime) >= oneDayAgo);
  const alertsLast7d = alerts.filter(a => new Date(a.alert_datetime) >= sevenDaysAgo);

  // Override O1: Active alert (within last 5 min) → 100%
  const fiveMinAgo = new Date(nowMs - 5 * 60_000);
  const hasActiveAlert = alerts.some(a => new Date(a.alert_datetime) >= fiveMinAgo);

  if (hasActiveAlert) {
    return {
      region_slug: input.regionSlug,
      calculated_at: now.toISOString(),
      probability_score: 100,
      alert_count_24h: alertsLast24h.length,
      alert_count_7d: alertsLast7d.length,
      trend_direction: 'rising',
      has_active_alert: true,
    };
  }

  // Override O3: Never attacked → 0%
  if (alerts.length === 0) {
    return {
      region_slug: input.regionSlug,
      calculated_at: now.toISOString(),
      probability_score: 0,
      alert_count_24h: 0,
      alert_count_7d: 0,
      trend_direction: 'stable',
      has_active_alert: false,
    };
  }

  // ── Calculate 3 components ──

  // Component 1: Base rate
  const hoursSinceWarStart = (nowMs - WAR_START_MS) / HOUR_MS;
  const totalWindows = Math.floor(hoursSinceWarStart * 4);
  const windowsWithAlerts = countUniqueWindows(alerts);
  const baseRate = totalWindows > 0 ? (windowsWithAlerts / totalWindows) * 100 : 0;

  // Component 2: Hour multiplier
  const currentHourIsrael = getIsraelHour(nowMs);
  const hourMult = calculateHourMultiplier(alerts, currentHourIsrael);

  // Component 3: Momentum multiplier
  const momentum = calculateMomentumMultiplier(alerts, nowMs);

  // P = baseRate × hourMult × momentum
  let rawScore = baseRate * hourMult * momentum;

  // Override O2: Cap at 95
  rawScore = Math.min(95, rawScore);

  // Override O4: Floor at 1 if attacked in last 7 days
  if (rawScore < 1 && alertsLast7d.length > 0) {
    rawScore = 1;
  }

  const probability_score = Math.round(rawScore);

  // Trend direction
  const alertsDays2to7 = alertsLast7d.filter(a => new Date(a.alert_datetime) < twoDaysAgo);
  const recentRate = alertsLast24h.length;
  const olderRate = alertsDays2to7.length / 5;

  let trendDirection: 'rising' | 'falling' | 'stable' = 'stable';
  if (olderRate > 0) {
    if (recentRate > olderRate * 1.3) trendDirection = 'rising';
    else if (recentRate < olderRate * 0.7) trendDirection = 'falling';
  } else if (alertsLast24h.length > 0) {
    trendDirection = 'rising';
  }

  return {
    region_slug: input.regionSlug,
    calculated_at: now.toISOString(),
    probability_score,
    alert_count_24h: alertsLast24h.length,
    alert_count_7d: alertsLast7d.length,
    trend_direction: trendDirection,
    has_active_alert: false,
  };
}
