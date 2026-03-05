import { supabase } from '@/lib/supabase';
import { REGIONS } from '@/lib/regions';
import RegionGrid from '@/components/RegionGrid';
import ActiveAlertBanner from '@/components/ActiveAlertBanner';
import LastUpdateTimer from '@/components/LastUpdateTimer';
import type { RegionProbability, ProbabilitySnapshot } from '@/types';

export const revalidate = 60; // 1 minute

async function getLatestProbabilities(): Promise<RegionProbability[]> {
  const { data, error } = await supabase
    .from('latest_probabilities')
    .select('*');

  if (error) {
    console.error('Failed to fetch probabilities:', error);
    // Return regions with null probability on error
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
      <ActiveAlertBanner regions={regions} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">
            {'\u05E1\u05D9\u05DB\u05D5\u05D9 \u05D0\u05D6\u05E2\u05E7\u05D4 \u05DC\u05E4\u05D9 \u05D0\u05D6\u05D5\u05E8'}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {'\u05D4\u05E1\u05EA\u05D1\u05E8\u05D5\u05EA \u05DE\u05D7\u05D5\u05E9\u05D1\u05EA \u05E2\u05DC \u05D1\u05E1\u05D9\u05E1 \u05E0\u05D9\u05EA\u05D5\u05D7 7 \u05D9\u05DE\u05D9\u05DD \u05D0\u05D7\u05E8\u05D5\u05E0\u05D9\u05DD'}
          </p>
        </div>
        <LastUpdateTimer lastUpdate={lastUpdate} />
      </div>

      <RegionGrid regions={regions} />

      <div className="mt-8 p-4 rounded-lg bg-gray-900/30 border border-gray-800">
        <h3 className="text-sm font-medium text-gray-400 mb-2">
          {'\u05D0\u05D9\u05DA \u05D6\u05D4 \u05E2\u05D5\u05D1\u05D3?'}
        </h3>
        <p className="text-xs text-gray-500 leading-relaxed">
          {'\u05D4\u05DE\u05E2\u05E8\u05DB\u05EA \u05DE\u05E0\u05EA\u05D7\u05EA \u05D4\u05EA\u05E8\u05E2\u05D5\u05EA \u05E4\u05D9\u05E7\u05D5\u05D3 \u05D4\u05E2\u05D5\u05E8\u05E3 \u05DE-7 \u05D4\u05D9\u05DE\u05D9\u05DD \u05D4\u05D0\u05D7\u05E8\u05D5\u05E0\u05D9\u05DD \u05D5\u05DE\u05D7\u05E9\u05D1\u05EA \u05D4\u05E1\u05EA\u05D1\u05E8\u05D5\u05EA \u05DC\u05D0\u05D6\u05E2\u05E7\u05D4 \u05E2\u05D1\u05D5\u05E8 \u05DB\u05DC \u05D0\u05D6\u05D5\u05E8. \u05D4\u05D7\u05D9\u05E9\u05D5\u05D1 \u05DE\u05EA\u05D1\u05E1\u05E1 \u05E2\u05DC \u05EA\u05D3\u05D9\u05E8\u05D5\u05EA, \u05E2\u05D3\u05DB\u05E0\u05D9\u05D5\u05EA, \u05D3\u05E4\u05D5\u05E1\u05D9 \u05E9\u05E2\u05D5\u05EA, \u05D5\u05DE\u05D2\u05DE\u05D4. \u05D4\u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05DE\u05EA\u05E2\u05D3\u05DB\u05E0\u05D9\u05DD \u05DB\u05DC 15 \u05D3\u05E7\u05D5\u05EA. \u05D0\u05D9\u05DF \u05DE\u05D3\u05D5\u05D1\u05E8 \u05D1\u05D7\u05D9\u05D6\u05D5\u05D9 \u2014 \u05D0\u05DC\u05D0 \u05D1\u05D4\u05E2\u05E8\u05DB\u05EA \u05E1\u05D9\u05DB\u05D5\u05D9 \u05E1\u05D8\u05D8\u05D9\u05E1\u05D8\u05D9\u05EA.'}
        </p>
      </div>
    </div>
  );
}
