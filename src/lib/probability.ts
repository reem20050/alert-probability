import type { Alert, ProbabilitySnapshot } from '@/types';

interface ProbabilityInput {
  regionSlug: string;
  alerts: Alert[];
  now?: Date;
}

const WEIGHTS = {
  frequency: 0.35,
  recency: 0.30,
  timePattern: 0.20,
  trend: 0.15,
};

const RECENCY_HALF_LIFE_MS = 6 * 60 * 60 * 1000; // 6 hours

export function calculateProbability(input: ProbabilityInput): Omit<ProbabilitySnapshot, 'id'> {
  const now = input.now ?? new Date();
  const alerts = input.alerts.filter(a => a.region_slug === input.regionSlug);

  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  const alertsLast24h = alerts.filter(a => new Date(a.alert_datetime) >= oneDayAgo);
  const alertsLast7d = alerts.filter(a => new Date(a.alert_datetime) >= sevenDaysAgo);
  const alertsLast2d = alerts.filter(a => new Date(a.alert_datetime) >= twoDaysAgo);
  const alertsDays3to7 = alertsLast7d.filter(a => new Date(a.alert_datetime) < twoDaysAgo);

  // Check if there's an active alert (within last 5 minutes)
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
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

  // 1. Frequency Score (35%) - % of 15-min windows with alerts in last 7 days
  const totalWindows7d = 7 * 24 * 4; // 672 windows
  const windowsWithAlerts = countUniqueWindows(alertsLast7d);
  const frequencyRatio = windowsWithAlerts / totalWindows7d;
  const frequencyScore = Math.min(100, Math.log1p(frequencyRatio * 100) * 30);

  // 2. Recency Score (30%) - Exponential decay from most recent alert
  let recencyScore = 0;
  if (alertsLast7d.length > 0) {
    const mostRecent = Math.max(...alertsLast7d.map(a => new Date(a.alert_datetime).getTime()));
    const timeSince = now.getTime() - mostRecent;
    recencyScore = 100 * Math.exp(-0.693 * timeSince / RECENCY_HALF_LIFE_MS);
  }

  // 3. Time Pattern Score (20%) - Is current hour historically active?
  const currentHour = now.getHours();
  const hourWindow = [currentHour - 1, currentHour, currentHour + 1].map(h => ((h % 24) + 24) % 24);
  const alertsInHourWindow = alertsLast7d.filter(a => {
    const h = new Date(a.alert_datetime).getHours();
    return hourWindow.includes(h);
  });
  const timePatternScore = Math.min(100, alertsInHourWindow.length * 15);

  // 4. Trend Score (15%) - Last 2 days vs days 3-7
  let trendScore = 50; // neutral
  const recentRate = alertsLast2d.length / 2;
  const olderRate = alertsDays3to7.length / 5;
  if (olderRate > 0) {
    const trendRatio = recentRate / olderRate;
    trendScore = Math.min(100, Math.max(0, trendRatio * 50));
  } else if (alertsLast2d.length > 0) {
    trendScore = 80;
  }

  // Determine trend direction
  let trendDirection: 'rising' | 'falling' | 'stable' = 'stable';
  if (recentRate > olderRate * 1.3) trendDirection = 'rising';
  else if (recentRate < olderRate * 0.7) trendDirection = 'falling';

  // Composite score (max 95 without active alert)
  const rawScore =
    WEIGHTS.frequency * frequencyScore +
    WEIGHTS.recency * recencyScore +
    WEIGHTS.timePattern * timePatternScore +
    WEIGHTS.trend * trendScore;

  const probability_score = Math.min(95, Math.round(rawScore));

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

function countUniqueWindows(alerts: Alert[]): number {
  const windows = new Set<string>();
  for (const a of alerts) {
    const d = new Date(a.alert_datetime);
    const windowKey = `${d.toISOString().split('T')[0]}-${d.getHours()}-${Math.floor(d.getMinutes() / 15)}`;
    windows.add(windowKey);
  }
  return windows.size;
}
