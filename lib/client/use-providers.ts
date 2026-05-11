'use client';

/*
 * Tiny shared cache for `/api/providers` so every AgentNode (and any
 * other UI bit that needs provider metadata) doesn't trigger its own
 * fetch. One in-flight request is reused across subscribers; the result
 * is held module-level and broadcast to every mounted hook instance.
 *
 * Invalidation: callers that mutate providers (e.g. the Hermes
 * connections modal) should call `refreshProviders()` after a successful
 * write so every mounted card re-renders with the new data.
 */

import { useEffect, useState } from 'react';
import type { ProviderInfo } from '@/lib/server/providers/types';

let cache: ProviderInfo[] | null = null;
let inFlight: Promise<ProviderInfo[]> | null = null;
const subscribers = new Set<(list: ProviderInfo[]) => void>();

async function loadOnce(): Promise<ProviderInfo[]> {
  if (cache) return cache;
  if (inFlight) return inFlight;
  inFlight = fetch('/api/providers')
    .then((r) => r.json() as Promise<{ providers?: ProviderInfo[] }>)
    .then((body) => {
      const list = Array.isArray(body.providers) ? body.providers : [];
      cache = list;
      for (const sub of subscribers) sub(list);
      return list;
    })
    .catch((err: unknown) => {
      console.warn('[use-providers] failed to load:', err);
      cache = [];
      for (const sub of subscribers) sub([]);
      return [];
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Force a re-fetch — call after creating / editing / deleting a
 * connection so dependent cards pick up the new label, icon kind, etc. */
export function refreshProviders(): void {
  cache = null;
  inFlight = null;
  void loadOnce();
}

/** Returns the cached provider list, fetching on first use. Empty array
 * while the initial load is in flight. */
export function useProviders(): ProviderInfo[] {
  const [list, setList] = useState<ProviderInfo[]>(() => cache ?? []);
  useEffect(() => {
    let cancelled = false;
    if (cache) {
      setList(cache);
    } else {
      void loadOnce().then((l) => {
        if (!cancelled) setList(l);
      });
    }
    const sub = (l: ProviderInfo[]) => {
      if (!cancelled) setList(l);
    };
    subscribers.add(sub);
    return () => {
      cancelled = true;
      subscribers.delete(sub);
    };
  }, []);
  return list;
}
