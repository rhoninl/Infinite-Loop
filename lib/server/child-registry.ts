/**
 * Process group registry for `detached: true` child spawns.
 *
 * The runner/script/list-cli-agents code paths spawn children with
 * `detached: true` so that on per-run cancel or timeout we can kill the whole
 * group (e.g. a wrapper shell plus its grandchildren). The same setting means
 * SIGINT to the server's process group doesn't reach those children — Ctrl+C
 * would otherwise leave provider CLIs running as orphans. Each spawn site
 * registers its pid here so server.ts can reap the lot on shutdown.
 *
 * Out of scope: non-detached spawns (e.g. `exec()` in conditions/command.ts)
 * stay in the server's process group and die with it on SIGINT — they don't
 * need to register here.
 */

const active = new Set<number>();

export function registerChild(pid: number): void {
  active.add(pid);
}

export function unregisterChild(pid: number): void {
  active.delete(pid);
}

export function activeChildCount(): number {
  return active.size;
}

/** Send `signal` to every tracked child's process group (falls back to the
 * pid alone if the group kill fails). Best-effort: errors are swallowed
 * because a child may have already exited between registration and the kill. */
export function killAllChildren(signal: NodeJS.Signals): void {
  for (const pid of active) {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // already gone
      }
    }
  }
}
