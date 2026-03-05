import { supabase } from '@/lib/supabase';
import { REGIONS } from '@/lib/regions';
import RegionGrid from '@/components/RegionGrid';
import ActiveAlertBanner from '@/components/ActiveAlertBanner';
import LastUpdateTimer from '@/components/LastUpdateTimer';
import AutoRefresh from '@/components/AutoRefresh';
import type { RegionProbability, ProbabilitySnapshot } from '@/types';

export const revalidate = 30; // 30 seconds ISR

async function getLatestProbabilities(): Promise<RegionProbability[]> {
  const { data, error } = await supabase
    .from('latest_probabilities')
    .select('*');

  if (error) {
    console.error('Failed to fetch probabilities:', error);
    return REGIONS.map((r) => ({ ...r, probability: null }));
  }

  return REGIONS.map((region) => {
    const prob = data?.find(
      (d: Record<string, unknown>) => d.region_slug === region.slug
    );
    return {
      ...region,
      probability: prob
        ? ({
            id: prob.id,
            region_slug: prob.region_slug,
            calculated_at: prob.calculated_at,
            probability_score: prob.probability_score,
            alert_count_24h: prob.alert_count_24h,
            alert_count_7d: prob.alert_count_7d,
            trend_direction: prob.trend_direction,
            has_active_alert: prob.has_active_alert,
          } as ProbabilitySnapshot)
        : null,
    };
  });
}

export default async function HomePage() {
  const regions = await getLatestProbabilities();
  const lastUpdate =
    regions.find((r) => r.probability)?.probability?.calculated_at ?? null;

  return (
    <div>
      {/* Auto-refresh every 60 seconds */}
      <AutoRefresh intervalMs={60_000} />

      <ActiveAlertBanner regions={regions} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">סיכוי אזעקה לפי אזור</h2>
          <p className="text-sm text-gray-400 mt-1">
            הסתברויות מחושבת על בסיס ניתוח 7 ימים אחרונים
          </p>
        </div>
        <LastUpdateTimer lastUpdate={lastUpdate} />
      </div>

      <RegionGrid regions={regions} />

      <div className="mt-8 p-4 rounded-lg bg-gray-900/30 border border-gray-800">
        <h3 className="text-sm font-medium text-gray-400 mb-2">
          איך זה עובד?
        </h3>
        <p className="text-xs text-gray-500 leading-relaxed">
          המערכת מנתחת התרעות פיקוד העורף מ-7 הימים האחרונים ומחשבת הסתברות
          לאזעקה עבור כל אזור. החישוב מתבסס על תדירות, עדכניות, דפוסי שעות,
          ומגמה. הנתונים מתעדכנים כל 5 דקות. אין מדובר בחיזוי — אלא בהערכת
          סיכוי סטטיסטית.
        </p>
      </div>
    </div>
  );
}
