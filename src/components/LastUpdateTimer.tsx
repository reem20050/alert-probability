'use client';

import { useEffect, useState } from 'react';

interface Props {
  lastUpdate: string | null;
}

export default function LastUpdateTimer({ lastUpdate }: Props) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (!lastUpdate) return null;

  const date = new Date(lastUpdate);
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);

  return (
    <div className="text-sm text-gray-500 flex items-center gap-2">
      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
      <span>
        עדכון אחרון:{' '}
        {diffMin < 1 ? 'כרגע' : `לפני ${diffMin} דקות`}
      </span>
    </div>
  );
}
