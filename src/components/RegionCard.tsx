'use client';

import Link from 'next/link';
import ProbabilityGauge from './ProbabilityGauge';
import { getProbabilityLevel } from '@/lib/constants';
import type { RegionProbability } from '@/types';

interface Props {
  region: RegionProbability;
}

export default function RegionCard({ region }: Props) {
  const score = region.probability?.probability_score ?? 0;
  const level = getProbabilityLevel(score);
  const trend = region.probability?.trend_direction ?? 'stable';
  const trendIcon = trend === 'rising' ? '↑' : trend === 'falling' ? '↓' : '→';
  const trendColor =
    trend === 'rising'
      ? 'text-red-400'
      : trend === 'falling'
        ? 'text-green-400'
        : 'text-gray-400';

  const updatedAt = region.probability?.calculated_at
    ? getTimeAgo(new Date(region.probability.calculated_at))
    : 'אין נתונים';

  return (
    <Link href={`/region/${region.slug}`}>
      <div
        className="relative rounded-xl border border-gray-800 bg-gray-900/50 p-5 hover:bg-gray-900/80 transition-all duration-300 cursor-pointer group"
        style={{
          boxShadow: `0 0 20px ${level.color}15, inset 0 1px 0 ${level.color}10`,
        }}
      >
        {region.probability?.has_active_alert && (
          <div className="absolute top-2 left-2 flex items-center gap-1">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
            <span className="text-xs text-red-400 font-medium">אזעקה פעילה</span>
          </div>
        )}

        <h3 className="text-lg font-semibold mb-3 group-hover:text-white transition-colors">
          {region.name_he}
        </h3>

        <div className="relative flex justify-center my-2">
          <ProbabilityGauge score={score} />
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <div className="flex gap-3">
            <span className="text-gray-400">
              24ש:{' '}
              <span className="text-white font-medium">
                {region.probability?.alert_count_24h ?? 0}
              </span>
            </span>
            <span className="text-gray-400">
              7י:{' '}
              <span className="text-white font-medium">
                {region.probability?.alert_count_7d ?? 0}
              </span>
            </span>
          </div>
          <span className={`font-medium ${trendColor}`}>
            {trendIcon}{' '}
            {trend === 'rising' ? 'עולה' : trend === 'falling' ? 'יורד' : 'יציב'}
          </span>
        </div>

        <div className="mt-2 text-xs text-gray-500 text-center">
          עדכון: {updatedAt}
        </div>
      </div>
    </Link>
  );
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'כרגע';
  if (diffMin < 60) return `לפני ${diffMin} דקות`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `לפני ${diffHours} שעות`;
  return `לפני ${Math.floor(diffHours / 24)} ימים`;
}
