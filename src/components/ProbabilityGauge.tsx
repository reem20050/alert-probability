'use client';

import { getProbabilityLevel } from '@/lib/constants';

interface Props {
  score: number;
  size?: number;
}

export default function ProbabilityGauge({ score, size = 140 }: Props) {
  const level = getProbabilityLevel(score);
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75; // 270 degrees
  const offset = arcLength - (arcLength * score) / 100;

  return (
    <div className="flex flex-col items-center relative">
      <svg width={size} height={size} viewBox="0 0 100 100" className="-rotate-[135deg]">
        {/* Background arc */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="#1f2937"
          strokeWidth="8"
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeLinecap="round"
        />
        {/* Colored arc */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={level.color}
          strokeWidth="8"
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
          style={{ filter: `drop-shadow(0 0 6px ${level.color}40)` }}
        />
      </svg>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{ width: size, height: size }}
      >
        <span className="text-3xl font-bold" style={{ color: level.color }}>
          {score}%
        </span>
        <span className="text-xs text-gray-400 mt-1">{level.label_he}</span>
      </div>
    </div>
  );
}
