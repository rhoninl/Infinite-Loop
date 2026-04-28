'use client';

import { useEffect, useState } from 'react';
import type { RunEvent, WsStatus } from '../shared/types';

export interface UseRunEventsResult {
  events: RunEvent[];
  status: WsStatus;
}

export function useRunEvents(): UseRunEventsResult {
  const [events] = useState<RunEvent[]>([]);
  const [status] = useState<WsStatus>('closed');

  useEffect(() => {
    // Phase B unit 6 will implement: connect to /ws, parse RunEvent JSON,
    // append to events, manage status, reconnect on drop.
  }, []);

  return { events, status };
}
