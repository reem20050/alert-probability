'use client';

import { useEffect, useState } from 'react';
import type { RegionProbability } from '@/types';

interface Props {
  regions: RegionProbability[];
}

export default function ActiveAlertBanner({ regions }: Props) {
  const [visible, setVisible] = useState(false);
  const activeRegions = regions.filter((r) => r.probability?.has_active_alert);

  useEffect(() => {
    setVisible(activeRegions.length > 0);
  }, [activeRegions.length]);

  if (!visible) return null;

  return (
    <div className="mb-6 rounded-lg bg-red-900/50 border border-red-700 p-4 animate-pulse">
      <div className="flex items-center gap-3">
        <span className="text-2xl" role="img" aria-label="alert">
          {'\uD83D\uDEA8'}
        </span>
        <div>
          <h2 className="text-lg font-bold text-red-300">
            {'\u05D0\u05D6\u05E2\u05E7\u05D4 \u05E4\u05E2\u05D9\u05DC\u05D4!'}
          </h2>
          <p className="text-sm text-red-200">
            {'\u05D0\u05D6\u05E2\u05E7\u05D5\u05EA \u05E4\u05E2\u05D9\u05DC\u05D5\u05EA \u05D1'}:{' '}
            {activeRegions.map((r) => r.name_he).join(', ')}
          </p>
        </div>
      </div>
    </div>
  );
}
