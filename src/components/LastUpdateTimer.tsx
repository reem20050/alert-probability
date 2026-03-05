'use client';

import { useEffect, useState } from 'react';

interface Props {
  lastUpdate: string | null;
}

export default function LastUpdateTimer({ lastUpdate }: Props) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  if (!lastUpdate) return null;

  const date = new Date(lastUpdate);
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);

  return (
    <div className="text-sm text-gray-500 flex items-center gap-2">
      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
      <span>
        {'\u05E2\u05D3\u05DB\u05D5\u05DF \u05D0\u05D7\u05E8\u05D5\u05DF'}:{' '}
        {diffMin < 1
          ? '\u05DB\u05E8\u05D2\u05E2'
          : `\u05DC\u05E4\u05E0\u05D9 ${diffMin} \u05D3\u05E7\u05D5\u05EA`}
      </span>
    </div>
  );
}
