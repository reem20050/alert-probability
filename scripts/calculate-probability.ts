import { db } from './db';

const REGIONS = [
  'gush-dan', 'sharon', 'shfela', 'negev', 'haifa',
  'galilee', 'jerusalem', 'gaza-envelope', 'judea-samaria', 'eilat-arava'
];

// Regional adjacency map for spillover scoring
const NEIGHBORS: Record<string, string[]> = {
  'gush-dan':       ['sharon', 'shfela', 'jerusalem'],
  'sharon':         ['gush-dan', 'haifa', 'judea-samaria'],
  'shfela':         ['gush-dan', 'jerusalem', 'gaza-envelope', 'negev'],
  'negev':          ['shfela', 'gaza-envelope', 'eilat-arava'],
  'haifa':          ['sharon', 'galilee'],
  'galilee':        ['haifa', 'judea-samaria'],
  'jerusalem':      ['gush-dan', 'shfela', 'judea-samaria'],
  'gaza-envelope':  ['shfela', 'negev'],
  'judea-samaria':  ['sharon', 'galilee', 'jerusalem'],
  'eilat-arava':    ['negev'],
};

// Weights for each factor
const W = {
  recentActivity: 0.30,   // How recently were there alerts?
  intensity:      0.25,   // How intense is the current attack?
  timePattern:    0.15,   // Do attacks happen at this time of day?
  trend:          0.15,   // Is the situation escalating?
  regionalSpill:  0.15,   // Are neighboring regions being attacked?
};

/** Get hour (0-23) in Israel timezone */
function getIsraelHour(date: Date): number {
  return parseInt(date.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false }));
}

/**
 * Deduplicate alerts: group alerts within a 2-minute window into single "events".
 * When a rocket salvo hits a region, multiple cities get alerts within seconds.
 * We treat these as ONE event, not 15+ separate alerts.
 *
 * Returns an array of "event" objects, each with:
 * - alert_datetime: the earliest alert in the group (event start)
 * - city_count: how many cities were alerted in this event
 */
function deduplicateAlerts(alerts: any[]): { alert_datetime: string; city_count: number }[] {
  if (alerts.length === 0) return [];

  // Sort by datetime ascending
  const sorted = [...alerts].sort(
    (a, b) => new Date(a.alert_datetime).getTime() - new Date(b.alert_datetime).getTime()
  );

  const events: { alert_datetime: string; city_count: number }[] = [];
  let eventStart = new Date(sorted[0].alert_datetime).getTime();
  let eventDatetime = sorted[0].alert_datetime;
  let cityCount = 1;

  for (let i = 1; i < sorted.length; i++) {
    const ts = new Date(sorted[i].alert_datetime).getTime();
    if (ts - eventStart <= 2 * 60 * 1000) {
      // Within 2-minute window — same event
      cityCount++;
    } else {
      // New event
      events.push({ alert_datetime: eventDatetime, city_count: cityCount });
      eventStart = ts;
      eventDatetime = sorted[i].alert_datetime;
      cityCount = 1;
    }
  }
  // Push last event
  events.push({ alert_datetime: eventDatetime, city_count: cityCount });

  return events;
}

/**
 * Factor 1: Recent Activity (0-100)
 * Multi-timescale scoring — the more recent the alerts, the higher the score.
 * Uses tiered windows with exponential decay within each tier.
 * Now operates on deduplicated events (not raw alerts).
 */
function scoreRecentActivity(events: { alert_datetime: string; city_count: number }[], nowMs: number): number {
  if (events.length === 0) return 0;

  const mostRecentMs = Math.max(...events.map(e => new Date(e.alert_datetime).getTime()));
  const ageMinutes = (nowMs - mostRecentMs) / (60 * 1000);

  // Tiered scoring based on recency
  if (ageMinutes <= 5)   return 98;  // Active right now
  if (ageMinutes <= 15)  return 92;  // Just happened
  if (ageMinutes <= 60)  return 75 + (1 - ageMinutes / 60) * 15;  // Last hour: 75-90
  if (ageMinutes <= 360) return 45 + (1 - ageMinutes / 360) * 30;  // Last 6h: 45-75
  if (ageMinutes <= 1440) return 20 + (1 - ageMinutes / 1440) * 25; // Last 24h: 20-45
  if (ageMinutes <= 4320) return 8 + (1 - ageMinutes / 4320) * 12;  // Last 3d: 8-20
  if (ageMinutes <= 10080) return 2 + (1 - ageMinutes / 10080) * 6; // Last 7d: 2-8
  return Math.max(0, 2 * Math.exp(-ageMinutes / 20160)); // Beyond 7d: exponential decay
}

/**
 * Factor 2: Attack Intensity (0-100)
 * How many alert EVENTS happened in recent time windows.
 * A burst of 5 salvos in an hour matters more than 5 spread over a week.
 * Now operates on deduplicated events (not raw alerts).
 */
function scoreIntensity(events: { alert_datetime: string; city_count: number }[], nowMs: number): number {
  if (events.length === 0) return 0;

  // Count events in different windows
  let last1h = 0, last6h = 0, last24h = 0, last7d = 0;
  for (const e of events) {
    const ageMs = nowMs - new Date(e.alert_datetime).getTime();
    if (ageMs < 1 * 60 * 60 * 1000) last1h++;
    if (ageMs < 6 * 60 * 60 * 1000) last6h++;
    if (ageMs < 24 * 60 * 60 * 1000) last24h++;
    if (ageMs < 7 * 24 * 60 * 60 * 1000) last7d++;
  }

  // Events per hour in each window, normalized to 0-100
  // Thresholds adjusted: events are fewer than raw alerts
  const rateScores = [
    Math.min(100, last1h * 20),             // 5+ events/hour = 100
    Math.min(100, (last6h / 6) * 25),       // ~4 events/hour avg over 6h = 100
    Math.min(100, (last24h / 24) * 35),     // ~3 events/hour avg over 24h = 100
    Math.min(100, (last7d / 168) * 60),     // ~2 events/hour avg over 7d = 100
  ];

  // Take the max — a burst in any window counts
  return Math.max(...rateScores);
}

/**
 * Factor 3: Time-of-Day Pattern (0-100)
 * Do historical attacks tend to happen at this time of day?
 * Looks at ±2 hour window from current Israel time.
 * Now operates on deduplicated events (not raw alerts).
 */
function scoreTimePattern(events: { alert_datetime: string; city_count: number }[], currentIsraelHour: number): number {
  if (events.length === 0) return 0;

  // Count events in ±2h window vs total
  const windowHours = new Set<number>();
  for (let h = currentIsraelHour - 2; h <= currentIsraelHour + 2; h++) {
    windowHours.add(((h % 24) + 24) % 24);
  }

  let inWindow = 0;
  for (const e of events) {
    if (windowHours.has(getIsraelHour(new Date(e.alert_datetime)))) inWindow++;
  }

  // What fraction of events happen in this time window?
  // 5/24 = ~21% would be expected by chance
  const fraction = inWindow / events.length;
  const expectedFraction = 5 / 24; // 5 hours out of 24

  if (fraction <= expectedFraction) return Math.round(fraction / expectedFraction * 30); // Below average: 0-30
  // Above average: 30-100, scaled by how much above expected
  return Math.round(30 + 70 * Math.min(1, (fraction - expectedFraction) / (0.5 - expectedFraction)));
}

/**
 * Factor 4: Trend / Escalation (0-100)
 * Is the attack rate increasing or decreasing?
 * Compares last 24h to previous 48h (the 24-72h window).
 * Now operates on deduplicated events (not raw alerts).
 */
function scoreTrend(events: { alert_datetime: string; city_count: number }[], nowMs: number): { score: number; direction: string } {
  const last24h = events.filter(e => nowMs - new Date(e.alert_datetime).getTime() < 24 * 60 * 60 * 1000);
  const prev48h = events.filter(e => {
    const age = nowMs - new Date(e.alert_datetime).getTime();
    return age >= 24 * 60 * 60 * 1000 && age < 72 * 60 * 60 * 1000;
  });

  const recentRate = last24h.length / 1; // events per day (last 1 day)
  const olderRate = prev48h.length / 2;  // events per day (2-day window)

  if (olderRate === 0 && recentRate === 0) return { score: 0, direction: 'stable' };
  if (olderRate === 0 && recentRate > 0) return { score: 85, direction: 'rising' }; // New escalation

  const ratio = recentRate / olderRate;

  let direction = 'stable';
  if (ratio > 1.5) direction = 'rising';
  else if (ratio < 0.5) direction = 'falling';

  // Score: ratio of 2x+ = 100, 1x = 50, 0x = 0
  const score = Math.min(100, Math.max(0, ratio * 50));
  return { score, direction };
}

/**
 * Factor 5: Regional Spillover (0-100)
 * Are neighboring regions experiencing alerts?
 * If your neighbors are getting hit, you're more likely to be next.
 * Now operates on deduplicated events (not raw alerts).
 */
function scoreRegionalSpill(
  regionSlug: string,
  allEventsByRegion: Record<string, { alert_datetime: string; city_count: number }[]>,
  nowMs: number
): number {
  const neighbors = NEIGHBORS[regionSlug] ?? [];
  if (neighbors.length === 0) return 0;

  let neighborScore = 0;
  for (const n of neighbors) {
    const nEvents = allEventsByRegion[n] ?? [];
    // Count events in last 6h from this neighbor
    const recentCount = nEvents.filter(
      e => nowMs - new Date(e.alert_datetime).getTime() < 6 * 60 * 60 * 1000
    ).length;

    if (recentCount > 0) {
      // Each active neighbor contributes, diminishing returns
      neighborScore += Math.min(40, recentCount * 8);
    }
  }

  return Math.min(100, neighborScore);
}

async function calculateAll() {
  const now = new Date();
  const nowMs = now.getTime();
  console.log(`[${now.toISOString()}] Calculating probabilities (improved model v2)...`);

  // Fetch all alerts from last 30 days for comprehensive analysis
  const thirtyDaysAgo = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);

  const { data: alerts, error } = await db
    .from('alerts')
    .select('*')
    .gte('alert_datetime', thirtyDaysAgo.toISOString())
    .order('alert_datetime', { ascending: false });

  if (error) {
    console.error('Failed to fetch alerts:', error.message);
    process.exit(1);
  }

  console.log(`Found ${alerts?.length ?? 0} alerts in last 30 days`);

  // Group alerts by region
  const alertsByRegion: Record<string, any[]> = {};
  for (const r of REGIONS) alertsByRegion[r] = [];
  for (const a of alerts ?? []) {
    if (alertsByRegion[a.region_slug]) {
      alertsByRegion[a.region_slug].push(a);
    }
  }

  // Deduplicate: group alerts within 2-min windows into single "events" per region
  const eventsByRegion: Record<string, { alert_datetime: string; city_count: number }[]> = {};
  for (const r of REGIONS) {
    eventsByRegion[r] = deduplicateAlerts(alertsByRegion[r]);
  }

  const currentIsraelHour = getIsraelHour(now);
  const snapshots = [];

  for (const regionSlug of REGIONS) {
    const regionAlerts = alertsByRegion[regionSlug];  // raw alerts (for stats & active check)
    const regionEvents = eventsByRegion[regionSlug];  // deduplicated events (for scoring)

    // Calculate each factor using deduplicated events
    const recentActivity = scoreRecentActivity(regionEvents, nowMs);
    const intensity = scoreIntensity(regionEvents, nowMs);
    const timePattern = scoreTimePattern(regionEvents, currentIsraelHour);
    const { score: trendScore, direction: trendDirection } = scoreTrend(regionEvents, nowMs);
    const regionalSpill = scoreRegionalSpill(regionSlug, eventsByRegion, nowMs);

    // Weighted combination
    const rawScore =
      W.recentActivity * recentActivity +
      W.intensity * intensity +
      W.timePattern * timePattern +
      W.trend * trendScore +
      W.regionalSpill * regionalSpill;

    // Count stats
    const oneDayAgo = nowMs - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = nowMs - 7 * 24 * 60 * 60 * 1000;
    const fiveMinAgo = nowMs - 5 * 60 * 1000;
    const alertsLast24h = regionAlerts.filter((a: any) => new Date(a.alert_datetime).getTime() >= oneDayAgo);
    const alertsLast7d = regionAlerts.filter((a: any) => new Date(a.alert_datetime).getTime() >= sevenDaysAgo);
    const hasActiveAlert = regionAlerts.some((a: any) => new Date(a.alert_datetime).getTime() >= fiveMinAgo);

    // Final score: cap at 98% (100% only during active alert within 5 min)
    let finalScore = Math.round(rawScore);
    if (hasActiveAlert) finalScore = Math.max(finalScore, 95);
    finalScore = Math.min(98, finalScore);
    if (hasActiveAlert && recentActivity >= 98) finalScore = 100;

    snapshots.push({
      region_slug: regionSlug,
      calculated_at: now.toISOString(),
      probability_score: finalScore,
      alert_count_24h: alertsLast24h.length,
      alert_count_7d: alertsLast7d.length,
      trend_direction: trendDirection,
      has_active_alert: hasActiveAlert,
    });

    console.log(`  ${regionSlug}: ${finalScore}% [recent=${Math.round(recentActivity)} intensity=${Math.round(intensity)} time=${Math.round(timePattern)} trend=${Math.round(trendScore)}(${trendDirection}) spill=${Math.round(regionalSpill)}] alerts:${regionAlerts.length}→events:${regionEvents.length} 24h:${alertsLast24h.length} 7d:${alertsLast7d.length}`);
  }

  // Insert all snapshots
  const { error: insertError } = await db.from('probability_snapshots').insert(snapshots);

  if (insertError) {
    console.error('Failed to insert snapshots:', insertError.message);
    process.exit(1);
  }

  console.log(`\nInserted ${snapshots.length} probability snapshots`);
}

calculateAll();
