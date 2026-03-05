export interface Region {
  id: number;
  slug: string;
  name_he: string;
  name_en: string;
  display_order: number;
  lat: number;
  lng: number;
}

export interface Alert {
  id: number;
  city_name: string;
  region_slug: string;
  alert_datetime: string;
  category: string;
  raw_data: Record<string, unknown>;
}

export interface ProbabilitySnapshot {
  id: number;
  region_slug: string;
  calculated_at: string;
  probability_score: number;
  alert_count_24h: number;
  alert_count_7d: number;
  trend_direction: 'rising' | 'falling' | 'stable';
  has_active_alert: boolean;
}

export interface RegionProbability extends Region {
  probability: ProbabilitySnapshot | null;
}

export type ProbabilityLevel =
  | 'very-low' | 'low' | 'moderate'
  | 'elevated' | 'high' | 'very-high' | 'active';

export interface TzevaadomAlert {
  type?: number;
  alertDate?: string;
  isDrill?: boolean;
  data?: {
    cities?: string[];
    threat?: number;
  };
  threatName?: string;
  // Raw fields - API is undocumented
  [key: string]: unknown;
}

export interface CityRegionMapping {
  [cityName: string]: string; // city_name -> region_slug
}
