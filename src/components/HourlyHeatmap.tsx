'use client';

interface Props {
  hourlyCounts: number[]; // 24 values, index = hour
}

export default function HourlyHeatmap({ hourlyCounts }: Props) {
  const max = Math.max(...hourlyCounts, 1);

  return (
    <div>
      <div className="grid grid-cols-12 gap-1">
        {hourlyCounts.map((count, hour) => {
          const intensity = count / max;
          const bg =
            intensity === 0
              ? 'bg-gray-800'
              : intensity < 0.25
                ? 'bg-green-900'
                : intensity < 0.5
                  ? 'bg-yellow-900'
                  : intensity < 0.75
                    ? 'bg-orange-900'
                    : 'bg-red-900';

          return (
            <div key={hour} className="flex flex-col items-center">
              <div
                className={`w-full aspect-square rounded ${bg} flex items-center justify-center text-xs transition-colors`}
                title={`${hour}:00 - ${count} \u05D4\u05EA\u05E8\u05E2\u05D5\u05EA`}
                style={{ opacity: 0.3 + intensity * 0.7 }}
              >
                {count > 0 && <span className="text-[10px]">{count}</span>}
              </div>
              <span className="text-[9px] text-gray-600 mt-0.5">{hour}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-center gap-2 mt-2 text-xs text-gray-500">
        <span>{'\u05E4\u05D7\u05D5\u05EA'}</span>
        <div className="flex gap-0.5">
          <div className="w-3 h-3 rounded bg-gray-800" />
          <div className="w-3 h-3 rounded bg-green-900" />
          <div className="w-3 h-3 rounded bg-yellow-900" />
          <div className="w-3 h-3 rounded bg-orange-900" />
          <div className="w-3 h-3 rounded bg-red-900" />
        </div>
        <span>{'\u05D9\u05D5\u05EA\u05E8'}</span>
      </div>
    </div>
  );
}
