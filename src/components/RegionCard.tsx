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
  const trendIcon = trend === 'rising' ? '\u2191' : trend === 'falling' ? '\u2193' : '\u2192';
  const trendColor =
    trend === 'rising'
      ? 'text-red-400'
      : trend === 'falling'
        ? 'text-green-400'
        : 'text-gray-400';

  const updatedAt = region.probability?.calculated_at
    ? getTimeAgo(new Date(region.probability.calculated_at))
    : '\u05D0\u05D9\u05DF \u05E0\u05EA\u05D5\u05E0\u05D9\u05DD';

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
            <span className="text-xs text-red-400 font-medium">
              {'\u05D0\u05D6\u05E2\u05E7\u05D4 \u05E4\u05E2\u05D9\u05DC\u05D4'}
            </span>
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
              24\u05E9:{' '}
              <span className="text-white font-medium">
                {region.probability?.alert_count_24h ?? 0}
              </span>
            </span>
            <span className="text-gray-400">
              7\u05D9:{' '}
              <span className="text-white font-medium">
                {region.probability?.alert_count_7d ?? 0}
              </span>
            </span>
          </div>
          <span className={`font-medium ${trendColor}`}>
            {trendIcon}{' '}
            {trend === 'rising'
              ? '\u05E2\u05D5\u05DC\u05D4'
              : trend === 'falling'
                ? '\u05D9\u05D5\u05E8\u05D3'
                : '\u05D9\u05E6\u05D9\u05D1'}
          </span>
        </div>

        <div className="mt-2 text-xs text-gray-500 text-center">
          {'\u05E2\u05D3\u05DB\u05D5\u05DF'}: {updatedAt}
        </div>
      </div>
    </Link>
  );
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return '\u05DB\u05E8\u05D2\u05E2';
  if (diffMin < 60) return `\u05DC\u05E4\u05E0\u05D9 ${diffMin} \u05D3\u05E7\u05D5\u05EA`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24)
    return `\u05DC\u05E4\u05E0\u05D9 ${diffHours} \u05E9\u05E2\u05D5\u05EA`;
  return `\u05DC\u05E4\u05E0\u05D9 ${Math.floor(diffHours / 24)} \u05D9\u05DE\u05D9\u05DD`;
}
