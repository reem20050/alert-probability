-- Alerts indexes
CREATE INDEX IF NOT EXISTS idx_alerts_region_datetime
  ON alerts(region_slug, alert_datetime DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_datetime
  ON alerts(alert_datetime DESC);

-- Probability snapshots indexes
CREATE INDEX IF NOT EXISTS idx_prob_region_datetime
  ON probability_snapshots(region_slug, calculated_at DESC);

-- Latest probabilities view
CREATE OR REPLACE VIEW latest_probabilities AS
SELECT DISTINCT ON (region_slug)
  ps.*,
  r.name_he,
  r.name_en,
  r.display_order,
  r.lat,
  r.lng
FROM probability_snapshots ps
JOIN regions r ON r.slug = ps.region_slug
ORDER BY region_slug, calculated_at DESC;
