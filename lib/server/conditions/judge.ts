import type { ConditionStrategy, JudgeConfig } from '../../shared/types';
import { getProvider } from '../providers/loader';
import { runProvider } from '../providers/runner';

const STDOUT_TRUNCATE_CHARS = 8000;
const JUDGE_TIMEOUT_MS = 60000;
const JUDGE_PROVIDER_ID = 'claude';

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

    const provider = await getProvider(JUDGE_PROVIDER_ID);
    if (!provider) {
      return {
        met: false,
        detail: `judge error: provider "${JUDGE_PROVIDER_ID}" not found in providers/`,
      };
    }

    const { rubric, model } = cfg;
    const prompt = buildPrompt(rubric, iter.stdout);

    // The judge needs claude in plain `--print` mode (no stream-json), so we
    // synthesize a one-shot manifest derived from the registered claude
    // provider — same `bin` resolution (env override etc.), but stripped argv.
    const judgeManifest = {
      ...provider,
      args: ['--print', ...(model ? ['--model', model] : []), '{prompt}'],
      outputFormat: 'plain',
      promptVia: 'arg' as const,
    };

    const ctrl = new AbortController();
    const result = await runProvider(judgeManifest, {
      prompt,
      cwd,
      timeoutMs: JUDGE_TIMEOUT_MS,
      signal: ctrl.signal,
    });

    if (result.timedOut) {
      return { met: false, detail: `judge timed out after ${JUDGE_TIMEOUT_MS}ms` };
    }
    if (result.exitCode !== 0) {
      const errTail = result.stderr.trim().slice(-200);
      const outTail = errTail ? '' : result.stdout.trim().slice(-200);
      const suffix = errTail ? `: ${errTail}` : outTail ? `: ${outTail}` : '';
      return { met: false, detail: `judge error: exit code ${result.exitCode}${suffix}` };
    }

    const line = firstNonEmptyLine(result.stdout);
    if (line === null) {
      return { met: false, detail: 'judge error: no stdout' };
    }
    const verdict = line.toUpperCase();
    if (verdict === 'MET') return { met: true, detail: line };
    if (verdict === 'NOT_MET') return { met: false, detail: line };
    return { met: false, detail: `judge output unparseable: ${line.slice(0, 200)}` };
  },
};
