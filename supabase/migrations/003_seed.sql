INSERT INTO regions (slug, name_he, name_en, display_order, lat, lng) VALUES
  ('gush-dan', 'גוש דן', 'Gush Dan', 1, 32.08, 34.78),
  ('sharon', 'השרון', 'HaSharon', 2, 32.33, 34.86),
  ('shfela', 'השפלה', 'HaShfela', 3, 31.85, 34.87),
  ('negev', 'הנגב', 'HaNegev', 4, 31.25, 34.79),
  ('haifa', 'חיפה והקריות', 'Haifa', 5, 32.79, 34.99),
  ('galilee', 'הגליל', 'Galilee', 6, 32.96, 35.50),
  ('jerusalem', 'ירושלים והסביבה', 'Jerusalem', 7, 31.77, 35.23),
  ('gaza-envelope', 'עוטף עזה', 'Gaza Envelope', 8, 31.35, 34.38),
  ('judea-samaria', 'יהודה ושומרון', 'Judea & Samaria', 9, 32.00, 35.20),
  ('eilat-arava', 'אילת והערבה', 'Eilat & Arava', 10, 29.56, 34.95)
ON CONFLICT (slug) DO UPDATE SET
  name_he = EXCLUDED.name_he,
  name_en = EXCLUDED.name_en,
  display_order = EXCLUDED.display_order,
  lat = EXCLUDED.lat,
  lng = EXCLUDED.lng;

-- Insert initial zero-probability snapshots for all regions
INSERT INTO probability_snapshots (region_slug, calculated_at, probability_score, alert_count_24h, alert_count_7d, trend_direction, has_active_alert)
SELECT slug, NOW(), 0, 0, 0, 'stable', false
FROM regions;
