export const PROBABILITY_LEVELS = [
  { min: 0, max: 5, level: 'very-low' as const, label_he: 'נמוך מאוד', label_en: 'Very Low', color: '#22c55e', bg: 'bg-green-500' },
  { min: 5, max: 20, level: 'low' as const, label_he: 'נמוך', label_en: 'Low', color: '#84cc16', bg: 'bg-lime-500' },
  { min: 20, max: 40, level: 'moderate' as const, label_he: 'בינוני', label_en: 'Moderate', color: '#eab308', bg: 'bg-yellow-500' },
  { min: 40, max: 60, level: 'elevated' as const, label_he: 'מוגבר', label_en: 'Elevated', color: '#f97316', bg: 'bg-orange-500' },
  { min: 60, max: 80, level: 'high' as const, label_he: 'גבוה', label_en: 'High', color: '#ef4444', bg: 'bg-red-500' },
  { min: 80, max: 95, level: 'very-high' as const, label_he: 'גבוה מאוד', label_en: 'Very High', color: '#dc2626', bg: 'bg-red-600' },
  { min: 95, max: 100, level: 'active' as const, label_he: 'אזעקה פעילה', label_en: 'Active Alert', color: '#991b1b', bg: 'bg-red-900' },
] as const;

export function getProbabilityLevel(score: number) {
  return PROBABILITY_LEVELS.find(l => score >= l.min && score <= l.max) ?? PROBABILITY_LEVELS[0];
}

export function getProbabilityColor(score: number): string {
  return getProbabilityLevel(score).color;
}

export const REFRESH_INTERVAL_MS = 60_000; // 1 minute client-side refresh
export const REVALIDATE_SECONDS = 900; // 15 minutes ISR
export const TZEVAADOM_API_URL = 'https://api.tzevaadom.co.il/notifications';
