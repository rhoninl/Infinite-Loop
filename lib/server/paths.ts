import path from 'node:path';
import os from 'node:os';

export function dataDir(): string {
  return (
    process.env.INFLOOP_DATA_DIR || path.join(os.homedir(), '.infinite-loop')
  );
}

export function triggersDir(): string {
  return (
    process.env.INFLOOP_TRIGGERS_DIR || path.join(dataDir(), 'triggers')
  );
}
