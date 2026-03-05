-- Regions table
CREATE TABLE IF NOT EXISTS regions (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name_he TEXT NOT NULL,
  name_en TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  city_name TEXT NOT NULL,
  region_slug TEXT NOT NULL REFERENCES regions(slug),
  alert_datetime TIMESTAMPTZ NOT NULL,
  category TEXT DEFAULT 'unknown',
  raw_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(city_name, alert_datetime)
);

-- Probability snapshots table
CREATE TABLE IF NOT EXISTS probability_snapshots (
  id BIGSERIAL PRIMARY KEY,
  region_slug TEXT NOT NULL REFERENCES regions(slug),
  calculated_at TIMESTAMPTZ NOT NULL,
  probability_score INTEGER NOT NULL CHECK (probability_score >= 0 AND probability_score <= 100),
  alert_count_24h INTEGER DEFAULT 0,
  alert_count_7d INTEGER DEFAULT 0,
  trend_direction TEXT DEFAULT 'stable' CHECK (trend_direction IN ('rising', 'falling', 'stable')),
  has_active_alert BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- City to region mapping table
CREATE TABLE IF NOT EXISTS city_region_mapping (
  city_name TEXT PRIMARY KEY,
  region_slug TEXT NOT NULL REFERENCES regions(slug)
);
