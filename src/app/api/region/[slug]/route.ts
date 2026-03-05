import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const supabase = getSupabase();

    // Get latest probability
    const { data: latest, error: latestError } = await supabase
      .from('latest_probabilities')
      .select('*')
      .eq('region_slug', slug)
      .single();

    if (latestError) {
      return NextResponse.json({ error: latestError.message }, { status: 500 });
    }

    // Get 7-day trend data
    const sevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: trend } = await supabase
      .from('probability_snapshots')
      .select('calculated_at, probability_score')
      .eq('region_slug', slug)
      .gte('calculated_at', sevenDaysAgo)
      .order('calculated_at', { ascending: true });

    // Get recent alerts
    const { data: recentAlerts } = await supabase
      .from('alerts')
      .select('*')
      .eq('region_slug', slug)
      .gte('alert_datetime', sevenDaysAgo)
      .order('alert_datetime', { ascending: false })
      .limit(50);

    // Calculate hourly distribution
    const hourlyCounts = new Array(24).fill(0);
    recentAlerts?.forEach((alert: Record<string, unknown>) => {
      const hour = new Date(alert.alert_datetime as string).getHours();
      hourlyCounts[hour]++;
    });

    return NextResponse.json({
      current: latest,
      trend:
        trend?.map((t: Record<string, unknown>) => ({
          time: t.calculated_at,
          score: t.probability_score,
        })) ?? [],
      recentAlerts: recentAlerts ?? [],
      hourlyCounts,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 }
    );
  }
}
