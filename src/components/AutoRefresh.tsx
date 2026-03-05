'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

interface Props {
  intervalMs?: number;
}

/**
 * Invisible component that auto-refreshes the page's server data
 * by calling router.refresh() at a set interval.
 * This triggers RSC re-render without a full page reload.
 */
export default function AutoRefresh({ intervalMs = 60_000 }: Props) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return null;
}
