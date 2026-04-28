'use client';

import type { RunEvent, WsStatus } from '../../lib/shared/types';

export interface RunPanelProps {
  events: RunEvent[];
  wsStatus: WsStatus;
  onStop: () => void;
}

export default function RunPanel(_props: RunPanelProps) {
  return (
    <section aria-label="run panel">
      <p>(RunPanel not implemented — Phase B unit 8)</p>
    </section>
  );
}
