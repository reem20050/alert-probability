import { supabase } from '@/lib/supabase';
import { getRegionBySlug, getAllRegionSlugs } from '@/lib/regions';
import { getProbabilityLevel } from '@/lib/constants';
import ProbabilityGauge from '@/components/ProbabilityGauge';
import TrendChart from '@/components/TrendChart';
import HourlyHeatmap from '@/components/HourlyHeatmap';
import AutoRefresh from '@/components/AutoRefresh';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

export const revalidate = 30; // 30 seconds ISR

export async function generateStaticParams() {
  return getAllRegionSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const region = getRegionBySlug(slug);
  if (!region) return { title: 'אזור לא נמצא' };
  return {
    title: `סיכוי אזעקה - ${region.name_he}`,
    description: `הסתברות אזעקה ב${region.name_he} - ניתוח סטטיסטי`,
  };
}

async function getRegionData(slug: string) {
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();

  const [latestRes, trendRes, alertsRes] = await Promise.all([
    supabase
      .from('latest_probabilities')
      .select('*')
      .eq('region_slug', slug)
      .single(),
    supabase
      .from('probability_snapshots')
      .select('calculated_at, probability_score')
      .eq('region_slug', slug)
      .gte('calculated_at', sevenDaysAgo)
      .order('calculated_at', { ascending: true }),
    supabase
      .from('alerts')
      .select('*')
      .eq('region_slug', slug)
      .gte('alert_datetime', sevenDaysAgo)
      .order('alert_datetime', { ascending: false })
      .limit(50),
  ]);

  const hourlyCounts = new Array(24).fill(0);
  alertsRes.data?.forEach((a: Record<string, unknown>) => {
    const d = new Date(a.alert_datetime as string);
    const israelHour = parseInt(
      d.toLocaleString('en-US', {
        timeZone: 'Asia/Jerusalem',
        hour: 'numeric',
        hour12: false,
      })
    );
    hourlyCounts[israelHour]++;
  });

  return {
    current: latestRes.data,
    trend:
      trendRes.data?.map((t: Record<string, unknown>) => ({
        time: t.calculated_at as string,
        score: t.probability_score as number,
      })) ?? [],
    alerts: alertsRes.data ?? [],
    hourlyCounts,
  };
}

export default async function RegionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const region = getRegionBySlug(slug);
  if (!region) notFound();

  const data = await getRegionData(slug);
  const score = data.current?.probability_score ?? 0;
  const level = getProbabilityLevel(score);

  return (
    <div>
      {/* Auto-refresh every 60 seconds */}
      <AutoRefresh intervalMs={60_000} />

      <Link
        href="/"
        className="text-sm text-gray-400 hover:text-white mb-4 inline-block"
      >
        ← חזרה לכל האזורים
      </Link>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold">{region.name_he}</h2>
          <p className="text-gray-400 mt-1">{region.name_en}</p>
        </div>
        <div className="relative">
          <ProbabilityGauge score={score} size={160} />
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard label="סיכוי נוכחי" value={`${score}%`} color={level.color} />
        <StatCard
          label="התרעות 24 שעות"
          value={data.current?.alert_count_24h?.toString() ?? '0'}
        />
        <StatCard
          label="התרעות 7 ימים"
          value={data.current?.alert_count_7d?.toString() ?? '0'}
        />
        <StatCard
          label="מגמה"
          value={
            data.current?.trend_direction === 'rising'
              ? '↑ עולה'
              : data.current?.trend_direction === 'falling'
                ? '↓ יורד'
                : '→ יציב'
          }
          color={
            data.current?.trend_direction === 'rising'
              ? '#ef4444'
              : data.current?.trend_direction === 'falling'
                ? '#22c55e'
                : '#9ca3af'
          }
        />
      </div>

      {/* Trend chart */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 mb-6">
        <h3 className="text-lg font-semibold mb-4">
          מגמת סיכוי - 7 ימים אחרונים
        </h3>
        <TrendChart data={data.trend} regionName={region.name_he} />
      </div>

      {/* Hourly heatmap */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 mb-6">
        <h3 className="text-lg font-semibold mb-4">
          התפלגות שעתית של התרעות
        </h3>
        <HourlyHeatmap hourlyCounts={data.hourlyCounts} />
      </div>

      {/* Recent alerts */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
        <h3 className="text-lg font-semibold mb-4">התרעות אחרונות</h3>
        {data.alerts.length === 0 ? (
          <p className="text-gray-500 text-sm">
            אין התרעות ב-7 הימים האחרונים
          </p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {data.alerts.map(
              (alert: Record<string, unknown>, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 text-sm"
                >
                  <span className="font-medium">
                    {alert.city_name as string}
                  </span>
                  <span className="text-gray-400">
                    {new Date(
                      alert.alert_datetime as string
                    ).toLocaleString('he-IL', {
                      timeZone: 'Asia/Jerusalem',
                      day: 'numeric',
                      month: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div
        className="text-xl font-bold mt-1"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
