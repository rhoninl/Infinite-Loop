'use client';

import type { RunConfig } from '../../lib/shared/types';

export interface TaskFormProps {
  disabled?: boolean;
  onSubmit: (cfg: RunConfig) => void;
}

export default function TaskForm(_props: TaskFormProps) {
  return (
    <section aria-label="task form">
      <p>(TaskForm not implemented — Phase B unit 7)</p>
    </section>
  );
}
