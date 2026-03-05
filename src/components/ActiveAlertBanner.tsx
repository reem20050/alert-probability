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
          🚨
        </span>
        <div>
          <h2 className="text-lg font-bold text-red-300">אזעקה פעילה!</h2>
          <p className="text-sm text-red-200">
            אזעקות פעילות ב: {activeRegions.map((r) => r.name_he).join(', ')}
          </p>
        </div>
      </div>
    </div>
  );
}
