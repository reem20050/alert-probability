import { db } from './db';

// ============================================================
// ML-based Alert Probability — Logistic Regression v3
//
// Trains a per-region logistic regression model on sliding-window
// features extracted from alert event time series.
//
// Features (10): recency, intensity at multiple scales, time-of-day
//   pattern, neighbor activity, trend, city spread.
// Target: was there an alert in the next 60 minutes?
// Model: sigmoid(w·x + b), trained with gradient descent + L2 reg.
// ============================================================

const REGIONS = [
  'gush-dan', 'sharon', 'shfela', 'negev', 'haifa',
  'galilee', 'jerusalem', 'gaza-envelope', 'judea-samaria', 'eilat-arava',
];

const NEIGHBORS: Record<string, string[]> = {
  'gush-dan':      ['sharon', 'shfela', 'jerusalem'],
  'sharon':        ['gush-dan', 'haifa', 'judea-samaria'],
  'shfela':        ['gush-dan', 'jerusalem', 'gaza-envelope', 'negev'],
  'negev':         ['shfela', 'gaza-envelope', 'eilat-arava'],
  'haifa':         ['sharon', 'galilee'],
  'galilee':       ['haifa', 'judea-samaria'],
  'jerusalem':     ['gush-dan', 'shfela', 'judea-samaria'],
  'gaza-envelope': ['shfela', 'negev'],
  'judea-samaria': ['sharon', 'galilee', 'jerusalem'],
  'eilat-arava':   ['negev'],
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const NUM_FEATURES = 10;
const PREDICTION_WINDOW_MS = 60 * 60 * 1000; // predict next 1 hour
const WINDOW_STEP_MS = 15 * 60 * 1000;       // 15-min sliding window

// ============================================================
// Alert Event Deduplication — 2-minute window grouping
// ============================================================

interface AlertEvent {
  ts: number;          // milliseconds since epoch
  city_count: number;  // how many cities in this salvo
}

function deduplicateAlerts(alerts: any[]): AlertEvent[] {
  if (alerts.length === 0) return [];
  const sorted = [...alerts].sort(
    (a, b) => new Date(a.alert_datetime).getTime() - new Date(b.alert_datetime).getTime()
  );
  const events: AlertEvent[] = [];
  let eventStart = new Date(sorted[0].alert_datetime).getTime();
  let cities = 1;

  for (let i = 1; i < sorted.length; i++) {
    const ts = new Date(sorted[i].alert_datetime).getTime();
    if (ts - eventStart <= 120_000) {     // 2-minute window
      cities++;
    } else {
      events.push({ ts: eventStart, city_count: cities });
      eventStart = ts;
      cities = 1;
    }
  }
  events.push({ ts: eventStart, city_count: cities });
  return events;
}

// ============================================================
// Feature Extraction (10 features per region per timestamp)
// ============================================================

function getIsraelHour(ms: number): number {
  return parseInt(
    new Date(ms).toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false })
  );
}

/**
 * Extract 10 features for a region at a specific timestamp.
 *
 *  0  count_1h       log1p of events in last 1h (normalized)
 *  1  count_3h       log1p of events in last 3h
 *  2  count_6h       log1p of events in last 6h
 *  3  count_24h      log1p of events in last 24h
 *  4  recency        1 - min(1, minutes_since_last / 1440)
 *  5  hour_sin       sin(2pi * hour / 24)
 *  6  hour_cos       cos(2pi * hour / 24)
 *  7  neighbor_3h    log1p of neighbor events in last 3h
 *  8  trend          ratio of last 3h to prev 3h events (capped)
 *  9  city_spread    avg cities per event in last 3h (normalized)
 */
function extractFeatures(
  regionEvents: AlertEvent[],
  allEvents: Record<string, AlertEvent[]>,
  regionSlug: string,
  atMs: number,
): number[] {
  let c1h = 0, c3h = 0, c6h = 0, c24h = 0;
  let minAge = Infinity;
  let prev3hCount = 0;
  let spreadSum = 0, spreadN = 0;

  for (const e of regionEvents) {
    const age = atMs - e.ts;
    if (age < 0) continue;          // future event — skip
    if (age > 7 * DAY_MS) continue; // too old

    if (age < HOUR_MS) c1h++;
    if (age < 3 * HOUR_MS) { c3h++; spreadSum += e.city_count; spreadN++; }
    if (age < 6 * HOUR_MS) c6h++;
    if (age < DAY_MS) c24h++;
    if (age >= 3 * HOUR_MS && age < 6 * HOUR_MS) prev3hCount++;
    if (age < minAge) minAge = age;
  }

  // Neighbor activity in last 3h
  let neighborCount = 0;
  for (const n of (NEIGHBORS[regionSlug] ?? [])) {
    for (const e of (allEvents[n] ?? [])) {
      const age = atMs - e.ts;
      if (age >= 0 && age < 3 * HOUR_MS) neighborCount++;
    }
  }

  const hour = getIsraelHour(atMs);
  const minutesSinceLast = minAge === Infinity ? 1440 : minAge / 60_000;

  return [
    Math.log1p(c1h)  / 4,                                       // 0
    Math.log1p(c3h)  / 5,                                       // 1
    Math.log1p(c6h)  / 5.5,                                     // 2
    Math.log1p(c24h) / 6,                                       // 3
    1 - Math.min(1, minutesSinceLast / 1440),                    // 4
    Math.sin(2 * Math.PI * hour / 24),                           // 5
    Math.cos(2 * Math.PI * hour / 24),                           // 6
    Math.log1p(neighborCount) / 5,                               // 7
    prev3hCount === 0
      ? (c3h > 0 ? 1 : 0)
      : Math.min(1, (c3h / prev3hCount) / 2),                   // 8
    spreadN === 0 ? 0 : Math.min(1, (spreadSum / spreadN) / 20),// 9
  ];
}

// ============================================================
// Logistic Regression — pure TypeScript, zero dependencies
// ============================================================

interface Sample { x: number[]; y: number }

class LogisticRegression {
  w: number[];
  b: number;

  constructor(dim: number) {
    this.w = Array(dim).fill(0).map(() => (Math.random() - 0.5) * 0.1);
    this.b = 0;
  }

  private sigmoid(z: number): number {
    if (z >  500) return 1;
    if (z < -500) return 0;
    return 1 / (1 + Math.exp(-z));
  }

  predict(x: number[]): number {
    let z = this.b;
    for (let i = 0; i < this.w.length; i++) z += this.w[i] * x[i];
    return this.sigmoid(z);
  }

  /**
   * Train with mini-batch SGD + L2 regularisation.
   * Returns { loss, accuracy } on the training set.
   */
  train(
    data: Sample[],
    { epochs = 120, batchSize = 32, lr = 0.15, lambda = 0.01 } = {},
  ): { loss: number; accuracy: number } {
    if (data.length === 0) return { loss: 0, accuracy: 0 };

    let currentLr = lr;
    for (let ep = 0; ep < epochs; ep++) {
      // Fisher–Yates shuffle
      const idx = data.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }

      for (let start = 0; start < idx.length; start += batchSize) {
        const end = Math.min(start + batchSize, idx.length);
        const n = end - start;
        const gW = new Float64Array(this.w.length);
        let gB = 0;

        for (let k = start; k < end; k++) {
          const s = data[idx[k]];
          const err = this.predict(s.x) - s.y;
          for (let j = 0; j < this.w.length; j++) gW[j] += err * s.x[j];
          gB += err;
        }

        for (let j = 0; j < this.w.length; j++) {
          this.w[j] -= currentLr * (gW[j] / n + lambda * this.w[j]);
        }
        this.b -= currentLr * gB / n;
      }

      if (ep > 0 && ep % 30 === 0) currentLr *= 0.75;
    }

    return this.evaluate(data);
  }

  evaluate(data: Sample[]): { loss: number; accuracy: number } {
    let loss = 0, correct = 0;
    const eps = 1e-7;
    for (const s of data) {
      const p = this.predict(s.x);
      loss -= s.y * Math.log(p + eps) + (1 - s.y) * Math.log(1 - p + eps);
      if ((p >= 0.5) === (s.y === 1)) correct++;
    }
    return { loss: loss / data.length, accuracy: correct / data.length };
  }
}

// ============================================================
// Training Data Generation (sliding window)
// ============================================================

function buildSamples(
  regionSlug: string,
  regionEvents: AlertEvent[],
  allEvents: Record<string, AlertEvent[]>,
  fromMs: number,
  toMs: number,
): Sample[] {
  const samples: Sample[] = [];

  for (let t = fromMs; t < toMs - PREDICTION_WINDOW_MS; t += WINDOW_STEP_MS) {
    const x = extractFeatures(regionEvents, allEvents, regionSlug, t);

    // Label: any event in the next PREDICTION_WINDOW?
    const y = regionEvents.some(e => e.ts > t && e.ts <= t + PREDICTION_WINDOW_MS) ? 1 : 0;
    samples.push({ x, y });
  }
  return samples;
}

/**
 * Balance dataset: undersample majority class to max 2.5:1 ratio.
 * This prevents the model from always predicting "no alert".
 */
function balanceData(data: Sample[]): Sample[] {
  const pos = data.filter(s => s.y === 1);
  const neg = data.filter(s => s.y === 0);

  if (pos.length === 0) return data;                // no positives → nothing to balance
  if (neg.length <= pos.length * 2.5) return data;  // already balanced enough

  // Shuffle negatives and take 2.5× positives
  const shuffled = neg.sort(() => Math.random() - 0.5);
  return [...pos, ...shuffled.slice(0, Math.ceil(pos.length * 2.5))];
}

// ============================================================
// Main Pipeline
// ============================================================

async function calculateAll() {
  const now = new Date();
  const nowMs = now.getTime();
  console.log(`[${now.toISOString()}] ML Probability v3 — Logistic Regression\n`);

  // ── Fetch ALL alerts (paginated — Supabase defaults to 1000) ──
  const alerts: Array<{ region_slug: string; alert_datetime: string }> = [];
  const PAGE_SIZE = 1000; // Supabase caps at 1000 per request
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

  // ── Group & deduplicate ───────────────────────────────────
  const rawByRegion: Record<string, any[]> = {};
  for (const r of REGIONS) rawByRegion[r] = [];
  for (const a of alerts) {
    if (rawByRegion[a.region_slug]) rawByRegion[a.region_slug].push(a);
  }

  const eventsByRegion: Record<string, AlertEvent[]> = {};
  for (const r of REGIONS) eventsByRegion[r] = deduplicateAlerts(rawByRegion[r]);

  // ── Data range ────────────────────────────────────────────
  const dataStartMs = Math.min(...alerts.map(a => new Date(a.alert_datetime).getTime()));
  const trainCutoff = nowMs - 3 * HOUR_MS; // hold out last 3h for validation

  console.log(`Data: ${new Date(dataStartMs).toISOString()} → ${now.toISOString()}`);
  console.log(`Train cutoff: ${new Date(trainCutoff).toISOString()}\n`);

  // ── Per-region: train, validate, predict ──────────────────
  const snapshots = [];

  for (const region of REGIONS) {
    const events = eventsByRegion[region];
    const rawAlerts = rawByRegion[region];

    // Training set: start 24h in (so features have look-back history)
    const trainFrom = dataStartMs + DAY_MS;
    const trainSamples = buildSamples(region, events, eventsByRegion, trainFrom, trainCutoff);
    const balanced = balanceData(trainSamples);

    // Validation set: last 3h
    const validSamples = buildSamples(region, events, eventsByRegion, trainCutoff, nowMs);

    // Count class distribution
    const posCount = trainSamples.filter(s => s.y === 1).length;
    const negCount = trainSamples.filter(s => s.y === 0).length;

    // Train
    const model = new LogisticRegression(NUM_FEATURES);
    const trainMetrics = model.train(balanced, { epochs: 150, batchSize: 32, lr: 0.15, lambda: 0.01 });
    const validMetrics = validSamples.length > 0 ? model.evaluate(validSamples) : null;

    // ── Predict NOW ───────────────────────────────────────
    const currentX = extractFeatures(events, eventsByRegion, region, nowMs);
    let prob = model.predict(currentX) * 100;

    // ── Stats for snapshot ────────────────────────────────
    const alertsLast24h = rawAlerts.filter(a => nowMs - new Date(a.alert_datetime).getTime() < DAY_MS);
    const alertsLast7d  = rawAlerts.filter(a => nowMs - new Date(a.alert_datetime).getTime() < 7 * DAY_MS);
    const hasActive     = rawAlerts.some(a => nowMs - new Date(a.alert_datetime).getTime() < 5 * 60_000);

    // Trend
    const ev24h = events.filter(e => nowMs - e.ts < DAY_MS).length;
    const evPrev24h = events.filter(e => {
      const age = nowMs - e.ts;
      return age >= DAY_MS && age < 2 * DAY_MS;
    }).length;
    let trend = 'stable';
    if (evPrev24h > 0) {
      if (ev24h / evPrev24h > 1.5) trend = 'rising';
      else if (ev24h / evPrev24h < 0.5) trend = 'falling';
    } else if (ev24h > 0) { trend = 'rising'; }

    // ── Active-alert overrides ────────────────────────────
    if (hasActive) {
      prob = Math.max(prob, 95);
      if (prob >= 95) prob = 100;
    } else {
      prob = Math.min(prob, 98);
    }
    const score = Math.round(prob);

    snapshots.push({
      region_slug: region,
      calculated_at: now.toISOString(),
      probability_score: score,
      alert_count_24h: alertsLast24h.length,
      alert_count_7d: alertsLast7d.length,
      trend_direction: trend,
      has_active_alert: hasActive,
    });

    // ── Self-check log ────────────────────────────────────
    const vAcc = validMetrics ? `${(validMetrics.accuracy * 100).toFixed(0)}%` : 'n/a';
    console.log(
      `  ${region.padEnd(16)} ${String(score).padStart(3)}% | ` +
      `train ${balanced.length} (${posCount}+/${negCount}-) acc=${(trainMetrics.accuracy * 100).toFixed(0)}% | ` +
      `valid ${validSamples.length} acc=${vAcc} | ` +
      `24h:${alertsLast24h.length} ev:${events.length}`,
    );

    // Log feature weights for interpretability
    if (events.length > 0) {
      const featureNames = ['count1h','count3h','count6h','count24h','recency','hourSin','hourCos','neighbor','trend','spread'];
      const wStr = model.w.map((w, i) => `${featureNames[i]}=${w.toFixed(2)}`).join(' ');
      console.log(`    weights: ${wStr} bias=${model.b.toFixed(2)}`);
    }
  }

  // ── Insert snapshots ──────────────────────────────────────
  const { error: insertErr } = await db.from('probability_snapshots').insert(snapshots);
  if (insertErr) { console.error('Insert error:', insertErr.message); process.exit(1); }

  console.log(`\nInserted ${snapshots.length} snapshots (ML v3)`);

  // ── Self-validation summary ───────────────────────────────
  const highProb = snapshots.filter(s => s.probability_score >= 50);
  const activeRegions = snapshots.filter(s => s.has_active_alert);
  console.log(`\nSummary: ${highProb.length} regions >=50%, ${activeRegions.length} active alerts`);
}

calculateAll();
