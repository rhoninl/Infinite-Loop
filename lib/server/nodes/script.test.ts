import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  buildWrapperSource,
  extractResult,
  scriptExecutor,
} from './script';
import type { NodeExecutorContext, ScriptConfig } from '../../shared/workflow';

function ctx(
  config: unknown,
  overrides: Partial<NodeExecutorContext> = {},
): NodeExecutorContext {
  return {
    config,
    scope: {},
    defaultCwd: process.cwd(),
    signal: new AbortController().signal,
    ...overrides,
  };
}

const cfg = (over: Partial<ScriptConfig>): ScriptConfig => ({
  language: 'ts',
  inputs: {},
  outputs: [],
  code: '',
  ...over,
});

const ENV_KEYS = ['INFLOOP_BUN_BIN', 'INFLOOP_PYTHON_BIN'] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('extractResult', () => {
  it('pulls the result JSON off the sentinel line and strips it', () => {
    const out = extractResult(
      'starting\n__INFLOOP_RESULT__:{"output1":"hi"}\n',
    );
    expect(out.result).toEqual({ output1: 'hi' });
    expect(out.sanitizedStdout).not.toContain('__INFLOOP_RESULT__');
  });

  it('returns undefined result when no sentinel is present', () => {
    const out = extractResult('plain log\n');
    expect(out.result).toBeUndefined();
    expect(out.sanitizedStdout).toBe('plain log\n');
  });

  it('leaves a malformed sentinel line in place', () => {
    const out = extractResult('__INFLOOP_RESULT__:{not-json}\n');
    expect(out.result).toBeUndefined();
    expect(out.sanitizedStdout).toContain('__INFLOOP_RESULT__');
  });
});

describe('buildWrapperSource', () => {
  it('appends a TS harness that invokes run with arg-mapped payload', () => {
    const src = buildWrapperSource(
      'ts',
      'function run(a, b) { return { x: a + b }; }',
      ['a', 'b'],
    );
    expect(src).toContain('function run(a, b)');
    expect(src).toContain('["a","b"]');
    expect(src).toContain('__INFLOOP_RESULT__');
  });

  it('appends a Python harness with stdin-read + result print', () => {
    const src = buildWrapperSource(
      'py',
      'def run(a, b):\n    return { "x": a + b }',
      ['a', 'b'],
    );
    expect(src).toContain('def run(a, b)');
    expect(src).toContain('["a","b"]');
    expect(src).toContain('json.dumps');
  });
});

describe('scriptExecutor — config validation', () => {
  it('routes invalid configs to the error branch', async () => {
    const out = await scriptExecutor.execute(ctx({}));
    expect(out.branch).toBe('error');
    expect(out.outputs.errorMessage).toBe('invalid script config');
  });

  it('rejects unknown languages', async () => {
    const out = await scriptExecutor.execute(
      ctx({ language: 'rust', code: '', inputs: {}, outputs: [] }),
    );
    expect(out.branch).toBe('error');
  });
});

describe('scriptExecutor — TypeScript via Bun', () => {
  it('calls run with positional args and exposes declared outputs', async () => {
    const out = await scriptExecutor.execute(
      ctx(
        cfg({
          language: 'ts',
          inputs: { arg1: 'foo', arg2: 'bar' },
          outputs: ['greeting'],
          code:
            'function run(a, b) {\n' +
            '  return { greeting: a + " + " + b };\n' +
            '}\n',
        }),
      ),
    );
    expect(out.branch).toBe('next');
    expect(out.outputs.exitCode).toBe(0);
    expect(out.outputs.greeting).toBe('foo + bar');
  });

  it('coerces non-string return values to JSON strings for declared outputs', async () => {
    const out = await scriptExecutor.execute(
      ctx(
        cfg({
          language: 'ts',
          outputs: ['count', 'nested'],
          code:
            'function run() {\n' +
            '  return { count: 7, nested: { a: 1 } };\n' +
            '}\n',
        }),
      ),
    );
    expect(out.branch).toBe('next');
    expect(out.outputs.count).toBe('7');
    expect(out.outputs.nested).toBe('{"a":1}');
  });

  it('strips the sentinel from stdout so the run console stays clean', async () => {
    const out = await scriptExecutor.execute(
      ctx(
        cfg({
          language: 'ts',
          outputs: ['x'],
          code:
            'function run() {\n' +
            '  console.log("hello world");\n' +
            '  return { x: "ok" };\n' +
            '}\n',
        }),
      ),
    );
    expect(out.outputs.stdout).toContain('hello world');
    expect(out.outputs.stdout).not.toContain('__INFLOOP_RESULT__');
  });

  it('routes to error when the user did not define run', async () => {
    const out = await scriptExecutor.execute(
      ctx(
        cfg({
          language: 'ts',
          code: '// no run here',
          outputs: ['x'],
        }),
      ),
    );
    expect(out.branch).toBe('error');
    expect(out.outputs.exitCode).not.toBe(0);
  });
});

describe('scriptExecutor — Python via python3', () => {
  it('calls def run with positional args and exposes declared outputs', async () => {
    const out = await scriptExecutor.execute(
      ctx(
        cfg({
          language: 'py',
          inputs: { name: 'kiwi' },
          outputs: ['shout'],
          code:
            'def run(name):\n' +
            '    return { "shout": name.upper() }\n',
        }),
      ),
    );
    expect(out.branch).toBe('next');
    expect(out.outputs.shout).toBe('KIWI');
  });
});

describe('scriptExecutor — interpreter discovery', () => {
  it('fails cleanly when the interpreter is not on PATH', async () => {
    process.env.INFLOOP_BUN_BIN = '/nonexistent/bin/not-bun-anywhere';
    const out = await scriptExecutor.execute(
      ctx(cfg({ language: 'ts', code: 'function run() { return {}; }' })),
    );
    expect(out.branch).toBe('error');
    expect(out.outputs.exitCode).toBeNull();
    expect(out.outputs.errorMessage).toEqual(expect.any(String));
  });
});

describe('scriptExecutor — cancellation', () => {
  it('honors an already-aborted signal without spawning', async () => {
    const ac = new AbortController();
    ac.abort();
    const out = await scriptExecutor.execute(
      ctx(cfg({ language: 'ts', code: 'function run() { return {}; }' }), {
        signal: ac.signal,
      }),
    );
    expect(out.branch).toBe('error');
    expect(out.outputs.errorMessage).toBe('aborted');
  });

  it('kills the child process when the signal aborts mid-run', async () => {
    const ac = new AbortController();
    const promise = scriptExecutor.execute(
      ctx(
        cfg({
          language: 'ts',
          outputs: ['x'],
          code:
            'async function run() {\n' +
            '  await new Promise((r) => setTimeout(r, 5000));\n' +
            '  return { x: "should-not-return" };\n' +
            '}\n',
          timeoutMs: 10_000,
        }),
        { signal: ac.signal },
      ),
    );
    setTimeout(() => ac.abort(), 100);
    const out = await promise;
    expect(out.branch).toBe('error');
    expect(out.outputs.x).toBeUndefined();
  });
});
