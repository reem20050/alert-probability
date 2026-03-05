import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  _supabase = createClient(url, key);
  return _supabase;
}

// Lazy proxy — only creates client when actually used at runtime
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    try {
      return (getSupabase() as unknown as Record<string | symbol, unknown>)[prop];
    } catch {
      // During build, env vars may not exist. Return a fully chainable stub.
      if (prop === 'from') {
        const result = { data: null, error: null };
        const chainable: Record<string, unknown> = {};
        const methods = ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
          'like', 'ilike', 'is', 'in', 'contains', 'order', 'limit',
          'range', 'single', 'maybeSingle', 'filter', 'match',
          'insert', 'update', 'upsert', 'delete', 'or', 'not', 'then'];
        for (const m of methods) {
          chainable[m] = m === 'then'
            ? (resolve: (v: unknown) => void) => resolve(result)
            : () => chainable;
        }
        Object.assign(chainable, result);
        return () => chainable;
      }
      return undefined;
    }
  },
});

// Server-side client with service role key (for scripts/API routes)
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, serviceKey);
}
