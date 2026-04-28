import { spawn } from 'node:child_process';
import type { ConditionStrategy, JudgeConfig } from '../../shared/types';

const STDOUT_TRUNCATE_CHARS = 8000;
const JUDGE_TIMEOUT_MS = 60000;

function isValidJudgeConfig(cfg: unknown): cfg is JudgeConfig {
  if (cfg === null || typeof cfg !== 'object') return false;
  const c = cfg as Record<string, unknown>;
  if (typeof c.rubric !== 'string' || c.rubric.length === 0) return false;
  if (c.model !== undefined && typeof c.model !== 'string') return false;
  return true;
}

function buildPrompt(rubric: string, stdout: string): string {
  const truncated =
    stdout.length > STDOUT_TRUNCATE_CHARS
      ? stdout.slice(0, STDOUT_TRUNCATE_CHARS)
      : stdout;
  return (
    `You are a strict judge. Rubric: ${rubric}.\n` +
    `Iteration output (truncated to ${STDOUT_TRUNCATE_CHARS} chars):\n` +
    `---\n` +
    `${truncated}\n` +
    `---\n` +
    `Reply with exactly MET or NOT_MET on the first line, then optional one-line reason.`
  );
}

function firstNonEmptyLine(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

export const judgeStrategy: ConditionStrategy = {
  async evaluate(iter, cfg, cwd) {
    if (!isValidJudgeConfig(cfg)) {
      return { met: false, detail: 'invalid judge config' };
    }

    const { rubric, model } = cfg;
    const prompt = buildPrompt(rubric, iter.stdout);
    const bin = process.env.INFLOOP_CLAUDE_BIN || 'claude';
    const args = ['--print', ...(model ? ['--model', model] : []), prompt];

    return new Promise((resolve) => {
      let resolved = false;
      const finish = (result: { met: boolean; detail: string }) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolve(result);
      };

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(bin, args, { cwd });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        finish({ met: false, detail: `judge error: ${message}` });
        return;
      }

      let stdout = '';

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });

      child.on('error', (err) => {
        finish({ met: false, detail: `judge error: ${err.message}` });
      });

      child.on('close', (code) => {
        if (code !== 0) {
          const tail = stdout.trim().slice(-200);
          const suffix = tail ? `: ${tail}` : '';
          finish({
            met: false,
            detail: `judge error: exit code ${code}${suffix}`,
          });
          return;
        }

        const line = firstNonEmptyLine(stdout);
        if (line === null) {
          finish({ met: false, detail: 'judge error: no stdout' });
          return;
        }

        const verdict = line.toUpperCase();
        if (verdict === 'MET') {
          finish({ met: true, detail: line });
        } else if (verdict === 'NOT_MET') {
          finish({ met: false, detail: line });
        } else {
          const truncated = line.slice(0, 200);
          finish({
            met: false,
            detail: `judge output unparseable: ${truncated}`,
          });
        }
      });

      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore kill errors
        }
        finish({
          met: false,
          detail: `judge timed out after ${JUDGE_TIMEOUT_MS}ms`,
        });
      }, JUDGE_TIMEOUT_MS);
    });
  },
};
