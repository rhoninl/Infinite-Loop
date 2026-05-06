import type {
  JudgeNodeConfig,
  NodeExecutor,
  NodeExecutorContext,
  NodeExecutorResult,
} from '../../shared/workflow';
import { getProvider } from '../providers/loader';
import { runProvider } from '../providers/runner';

const JUDGE_TIMEOUT_MS = 60000;
const DEFAULT_PROVIDER_ID = 'claude';

const DEFAULT_SYSTEM_PROMPT =
  'You are a strict judge. Given the criteria and N candidates, return ONLY a JSON object on a single line:\n' +
  '  {"winner_index": <int>, "scores": [<int>...], "reasoning": "<short>"}\n' +
  '- winner_index is 0-based.\n' +
  '- scores is one integer per candidate, 1..10, higher = better.';

const STRICT_RETRY_PROMPT =
  'respond ONLY with the JSON object on a single line; no other text';

interface JudgeVerdict {
  winner_index: number;
  scores: number[];
  reasoning: string;
}

function isJudgeNodeConfig(cfg: unknown): cfg is JudgeNodeConfig {
  if (cfg === null || typeof cfg !== 'object') return false;
  const c = cfg as Record<string, unknown>;
  if (typeof c.criteria !== 'string') return false;
  if (!Array.isArray(c.candidates)) return false;
  if (!c.candidates.every((x) => typeof x === 'string')) return false;
  if (c.judgePrompt !== undefined && typeof c.judgePrompt !== 'string') return false;
  if (c.model !== undefined && typeof c.model !== 'string') return false;
  if (c.providerId !== undefined && typeof c.providerId !== 'string') return false;
  return true;
}

function buildPrompt(
  systemPrompt: string,
  criteria: string,
  candidates: string[],
): string {
  const numbered = candidates.map((c, i) => `[${i}] ${c}`).join('\n');
  return (
    `${systemPrompt}\n` +
    `Criteria: ${criteria}\n` +
    `Candidates:\n` +
    `${numbered}\n`
  );
}

/** Find the last non-empty line that looks like a `{...}` JSON object. */
function extractFinalJsonLine(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  }
  return null;
}

function parseAndValidate(
  stdout: string,
  candidatesLength: number,
): { ok: true; verdict: JudgeVerdict } | { ok: false; reason: string; raw: string } {
  const line = extractFinalJsonLine(stdout);
  if (line === null) {
    return { ok: false, reason: 'no JSON object line in stdout', raw: stdout };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    return {
      ok: false,
      reason: `JSON parse failed: ${(err as Error).message}`,
      raw: line,
    };
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, reason: 'parsed value is not an object', raw: line };
  }
  const obj = parsed as Record<string, unknown>;
  const wi = obj.winner_index;
  const scores = obj.scores;
  const reasoning = obj.reasoning;
  if (typeof wi !== 'number' || !Number.isInteger(wi)) {
    return { ok: false, reason: 'winner_index missing or not an integer', raw: line };
  }
  if (wi < 0 || wi >= candidatesLength) {
    return {
      ok: false,
      reason: `winner_index ${wi} out of range [0, ${candidatesLength})`,
      raw: line,
    };
  }
  if (!Array.isArray(scores) || scores.length !== candidatesLength) {
    return {
      ok: false,
      reason: `scores must be an array of length ${candidatesLength}`,
      raw: line,
    };
  }
  for (const s of scores) {
    if (typeof s !== 'number' || !Number.isInteger(s) || s < 1 || s > 10) {
      return {
        ok: false,
        reason: 'every score must be an integer in [1, 10]',
        raw: line,
      };
    }
  }
  return {
    ok: true,
    verdict: {
      winner_index: wi,
      scores: scores as number[],
      reasoning: typeof reasoning === 'string' ? reasoning : '',
    },
  };
}

export const judgeExecutor: NodeExecutor = {
  async execute(ctx: NodeExecutorContext): Promise<NodeExecutorResult> {
    const cfg = ctx.config;
    if (!isJudgeNodeConfig(cfg)) {
      return {
        outputs: { errorMessage: 'invalid judge node config' },
        branch: 'error',
      };
    }
    if (cfg.candidates.length < 2) {
      return {
        outputs: {
          errorMessage: `judge requires at least 2 candidates (got ${cfg.candidates.length})`,
        },
        branch: 'error',
      };
    }

    const providerId = cfg.providerId && cfg.providerId.length > 0
      ? cfg.providerId
      : DEFAULT_PROVIDER_ID;
    const provider = await getProvider(providerId);
    if (!provider) {
      return {
        outputs: { errorMessage: `unknown provider: ${providerId}` },
        branch: 'error',
      };
    }

    // The judge needs plain `--print` style output (single JSON line on stdout),
    // not stream-json. Synthesize a one-shot manifest derived from the
    // registered provider — same `bin` resolution (env override etc.), but
    // stripped argv. Mirrors lib/server/conditions/judge.ts.
    const judgeManifest = {
      ...provider,
      args: [
        '--print',
        ...(cfg.model ? ['--model', cfg.model] : []),
        '{prompt}',
      ],
      outputFormat: 'plain',
      promptVia: 'arg' as const,
    };

    const systemPrompt =
      cfg.judgePrompt && cfg.judgePrompt.length > 0
        ? cfg.judgePrompt
        : DEFAULT_SYSTEM_PROMPT;

    const attempt = async (
      sys: string,
    ): Promise<
      | { ok: true; verdict: JudgeVerdict }
      | { ok: false; reason: string; raw: string }
    > => {
      const prompt = buildPrompt(sys, cfg.criteria, cfg.candidates);
      const result = await runProvider(judgeManifest, {
        prompt,
        cwd: ctx.defaultCwd,
        timeoutMs: JUDGE_TIMEOUT_MS,
        signal: ctx.signal,
        onStdoutChunk: ctx.emitStdoutChunk,
      });
      if (ctx.signal.aborted) {
        return { ok: false, reason: 'aborted', raw: result.stdout };
      }
      if (result.timedOut) {
        return {
          ok: false,
          reason: `judge timed out after ${JUDGE_TIMEOUT_MS}ms`,
          raw: result.stdout,
        };
      }
      if (result.exitCode !== 0) {
        const errTail = result.stderr.trim().slice(-200);
        return {
          ok: false,
          reason: `judge exit code ${result.exitCode}${errTail ? `: ${errTail}` : ''}`,
          raw: result.stdout,
        };
      }
      return parseAndValidate(result.stdout, cfg.candidates.length);
    };

    let outcome = await attempt(systemPrompt);
    if (!outcome.ok && !ctx.signal.aborted) {
      outcome = await attempt(`${systemPrompt}\n${STRICT_RETRY_PROMPT}`);
    }

    if (ctx.signal.aborted) {
      return {
        outputs: { errorMessage: 'aborted' },
        branch: 'error',
      };
    }

    if (!outcome.ok) {
      return {
        outputs: {
          errorMessage: `judge failed: ${outcome.reason}`,
          raw: outcome.raw,
        },
        branch: 'error',
      };
    }

    const { winner_index, scores, reasoning } = outcome.verdict;
    return {
      outputs: {
        winner_index,
        winner: cfg.candidates[winner_index],
        scores,
        reasoning,
      },
      branch: 'next',
    };
  },
};
