'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { useWorkflowStore } from '@/lib/client/workflow-store-client';
import FolderPicker from './FolderPicker';
import type {
  AgentConfig,
  BranchConfig,
  BranchOp,
  ConditionConfig,
  ConditionKind,
  EndConfig,
  LoopConfig,
  Workflow,
  WorkflowNode,
} from '@/lib/shared/workflow';

const DEBOUNCE_MS = 200;

/** Walk the workflow's nodes (and each node's children) to find a node by id. */
function findNode(
  nodes: WorkflowNode[] | undefined,
  id: string,
): WorkflowNode | null {
  if (!nodes) return null;
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children && n.children.length > 0) {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** Collect all node ids in a workflow (recursing into containers). */
function collectAllIds(nodes: WorkflowNode[] | undefined): string[] {
  if (!nodes) return [];
  const out: string[] = [];
  for (const n of nodes) {
    out.push(n.id);
    if (n.children && n.children.length > 0) {
      out.push(...collectAllIds(n.children));
    }
  }
  return out;
}

/** Available `{{nodeId.stdout}}` template refs for a given node id. */
function availableRefs(workflow: Workflow | null, selfId: string): string[] {
  if (!workflow) return [];
  return collectAllIds(workflow.nodes)
    .filter((id) => id !== selfId)
    .map((id) => `{{${id}.stdout}}`);
}

/* ─── tiny debounced text field hook ───────────────────────── */
function useDebouncedString(
  initial: string,
  onCommit: (next: string) => void,
  delay = DEBOUNCE_MS,
): [string, (v: string) => void] {
  const [value, setValue] = useState(initial);
  // If the upstream value changes (e.g. node switch), re-sync.
  const lastInitial = useRef(initial);
  useEffect(() => {
    if (initial !== lastInitial.current) {
      lastInitial.current = initial;
      setValue(initial);
    }
  }, [initial]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = useCallback(
    (next: string) => {
      setValue(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        onCommit(next);
      }, delay);
    },
    [onCommit, delay],
  );

  // Flush on unmount so we don't lose the last keystroke.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return [value, set];
}

/* ─── timeout unit helpers ──────────────────────────────────── */
type TimeoutUnit = 's' | 'min' | 'hr';

const TIMEOUT_UNIT_MS: Record<TimeoutUnit, number> = {
  s: 1000,
  min: 60_000,
  hr: 3_600_000,
};

const TIMEOUT_UNITS: ReadonlyArray<TimeoutUnit> = ['s', 'min', 'hr'];

/** Pick the largest unit that represents `ms` cleanly (no fractional part).
 * 5 min as 300_000 ms reads as "5 min", not "300 s". Falls back to seconds
 * for the awkward middle values. */
function pickInitialTimeoutUnit(ms: number): TimeoutUnit {
  if (ms >= TIMEOUT_UNIT_MS.hr && ms % TIMEOUT_UNIT_MS.hr === 0) return 'hr';
  if (ms >= TIMEOUT_UNIT_MS.min && ms % TIMEOUT_UNIT_MS.min === 0) return 'min';
  return 's';
}

/* ─── segmented control ─────────────────────────────────────── */
interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
}
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div className="field" role="group" aria-label={label}>
      <span className="field-label">{label}</span>
      <div className="segmented">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            data-active={value === opt.value}
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── display-name field ────────────────────────────────────── */
/* Lets the user rename the canvas card's title independent of the node's
 * underlying id/type. Empty / whitespace-only commits clear the label so
 * the per-type fallback ("START", brand icon for agents, etc.) is used. */
function DisplayNameField({
  value,
  fallback,
  onCommit,
}: {
  value: string;
  fallback: string;
  onCommit: (next: string) => void;
}) {
  const [v, setV] = useDebouncedString(value, onCommit);
  return (
    <div className="field">
      <span className="field-label">Display name</span>
      <input
        aria-label="Display name"
        type="text"
        value={v}
        placeholder={fallback}
        onChange={(e) => setV(e.target.value)}
      />
      <span className="field-hint">
        Shown on the canvas card. Leave blank to use the default.
      </span>
    </div>
  );
}

/* ─── chips listing available template refs ────────────────── */
function RefChips({ refs }: { refs: string[] }) {
  if (refs.length === 0) return null;
  return (
    <div className="field-hint" aria-label="available template refs">
      {refs.length === 1 ? 'Available ref: ' : 'Available refs: '}
      {refs.join('  ·  ')}
    </div>
  );
}

/* ─── per-type forms ───────────────────────────────────────── */

function StartForm() {
  return (
    <p className="serif-italic" style={{ color: 'var(--fg-dim)' }}>
      Begin the workflow.
    </p>
  );
}

function EndForm({
  config,
  onPatch,
}: {
  config: EndConfig;
  onPatch: (next: EndConfig) => void;
}) {
  const outcome: NonNullable<EndConfig['outcome']> = config.outcome ?? 'succeeded';
  return (
    <Segmented<NonNullable<EndConfig['outcome']>>
      label="Outcome"
      value={outcome}
      options={[
        { value: 'succeeded', label: 'Succeeded' },
        { value: 'failed', label: 'Failed' },
      ]}
      onChange={(next) => onPatch({ ...config, outcome: next })}
    />
  );
}

function AgentForm({
  config,
  refs,
  onPatch,
}: {
  config: AgentConfig;
  refs: string[];
  onPatch: (next: AgentConfig) => void;
}) {
  const [prompt, setPrompt] = useDebouncedString(
    config.prompt ?? '',
    (next) => onPatch({ ...config, prompt: next }),
  );
  const [cwd, setCwd] = useDebouncedString(config.cwd ?? '', (next) =>
    onPatch({ ...config, cwd: next }),
  );
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  // Tail-truncate the cwd preview in JS — the previous direction:rtl CSS
  // trick is unreliable when the path starts with `/` (a bidi-neutral
  // character that the algorithm treats as a run boundary). Measure the
  // available width with a hidden monospace probe, count how many chars
  // fit, slice the path's tail to that length and prefix with an ellipsis.
  const cwdRef = useRef<HTMLDivElement | null>(null);
  const [cwdDisplay, setCwdDisplay] = useState(cwd);
  useLayoutEffect(() => {
    const el = cwdRef.current;
    if (!el || !cwd) {
      setCwdDisplay(cwd);
      return;
    }

    const recompute = () => {
      const cs = getComputedStyle(el);
      const padX =
        parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const usable = el.clientWidth - padX;
      if (usable <= 0) return;

      // Probe the rendered character width once per recompute (mono so any
      // glyph is the same width — `M` is just a stable reference).
      const probe = document.createElement('span');
      probe.style.font = cs.font;
      probe.style.visibility = 'hidden';
      probe.style.position = 'absolute';
      probe.style.whiteSpace = 'pre';
      probe.textContent = 'M';
      document.body.appendChild(probe);
      const charW = probe.getBoundingClientRect().width;
      document.body.removeChild(probe);
      if (charW <= 0) return;

      const fits = Math.floor(usable / charW);
      if (cwd.length <= fits) {
        setCwdDisplay(cwd);
      } else {
        // Reserve one slot for the leading ellipsis glyph.
        setCwdDisplay('…' + cwd.slice(cwd.length - (fits - 1)));
      }
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cwd]);

  const cwdInvalid = cwd.length > 0 && !cwd.startsWith('/');
  const providerId = config.providerId ?? 'claude';

  // Timeout: millisecond is the wire format (kept as `timeoutMs` on the
  // workflow), but a human entering "60000" was a paper cut. We let the
  // user pick a unit (s / min / hr) and convert at the field boundary.
  // Initial unit is auto-picked so an existing 5-min timeout reads as
  // "5 min" not "300 s".
  const timeoutMsRaw = config.timeoutMs ?? 60000;
  const [timeoutUnit, setTimeoutUnit] = useState<TimeoutUnit>(() =>
    pickInitialTimeoutUnit(timeoutMsRaw),
  );
  // Round display to 2 decimals so a value that doesn't divide cleanly into
  // the chosen unit (e.g. 1,000,000 ms shown as minutes = 16.6666…) renders
  // as `16.67` instead of a wall of repeating digits. Number() drops the
  // trailing zero so a clean value still reads as `60`, not `60.00`.
  const timeoutDisplay = Number(
    (timeoutMsRaw / TIMEOUT_UNIT_MS[timeoutUnit]).toFixed(2),
  );

  const onTimeoutChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '') return;
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) {
      const ms = Math.max(1000, Math.round(value * TIMEOUT_UNIT_MS[timeoutUnit]));
      onPatch({ ...config, timeoutMs: ms });
    }
  };

  return (
    <>
      <div className="field">
        <span className="field-label">Provider</span>
        <span
          className="field-hint"
          aria-label="Provider"
          style={{ fontFamily: 'var(--mono)', color: 'var(--fg-soft)' }}
        >
          {providerId}
        </span>
      </div>

      <div className="field">
        <span className="field-label">Prompt</span>
        <textarea
          aria-label="Prompt"
          required
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <RefChips refs={refs} />
      </div>

      <div className="field" style={{ position: 'relative' }}>
        <span className="field-label">Working directory</span>
        {/* Read-only preview of the resolved cwd. The only way to mutate it
         * is to open the picker (click, Enter, or Space) — the popover
         * handles both manual path entry and tree navigation, with the two
         * views live-synced. */}
        {/* Rendered as a div (not <input>) so CSS truncation can show the
         * TAIL of the path. Long cwds like
         * "/Users/liyuqi/project/Codecase/InfLoop" should anchor to
         * "…/Codecase/InfLoop" — the inner folder is what the user is
         * orienting on. `<input>` doesn't honour text-overflow: ellipsis
         * reliably and resets scrollLeft on focus, so a div is more honest. */}
        <div
          ref={cwdRef}
          role="button"
          tabIndex={0}
          aria-label="Working directory"
          aria-haspopup="dialog"
          aria-expanded={folderPickerOpen}
          aria-invalid={cwdInvalid || undefined}
          // `title` is the screen-reader / OS-level tooltip; the visible
          // hover tooltip is CSS-only via `::after` reading data-tooltip.
          // We carry both so the full path is always discoverable.
          title={cwd || undefined}
          data-tooltip={cwd || undefined}
          className={`field-readonly cwd-preview${cwd ? '' : ' is-empty'}`}
          onClick={() => setFolderPickerOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setFolderPickerOpen(true);
            }
          }}
        >
          {cwd ? cwdDisplay : '(no folder selected — click to choose)'}
        </div>
        {cwdInvalid && (
          <span className="field-hint" style={{ color: 'var(--accent-err)' }}>
            Must start with /
          </span>
        )}
        {folderPickerOpen && (
          <FolderPicker
            initialPath={cwd && cwd.startsWith('/') ? cwd : undefined}
            onSelect={(picked) => {
              setCwd(picked);
              setFolderPickerOpen(false);
            }}
            onClose={() => setFolderPickerOpen(false)}
          />
        )}
      </div>

      <div className="field">
        <span className="field-label">Iteration timeout</span>
        <div className="field-row">
          <input
            aria-label="Iteration timeout"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={timeoutDisplay}
            onChange={onTimeoutChange}
            className="no-spin"
          />
          <div
            className="seg-tight"
            role="group"
            aria-label="Iteration timeout unit"
          >
            {TIMEOUT_UNITS.map((u) => (
              <button
                key={u}
                type="button"
                data-active={timeoutUnit === u}
                aria-pressed={timeoutUnit === u}
                onClick={() => setTimeoutUnit(u)}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function ConditionForm({
  config,
  refs,
  onPatch,
}: {
  config: ConditionConfig;
  refs: string[];
  onPatch: (next: ConditionConfig) => void;
}) {
  const kind: ConditionKind = config.kind ?? 'sentinel';

  const [against, setAgainst] = useDebouncedString(
    config.against ?? '',
    (next) => onPatch({ ...config, against: next }),
  );
  const [pattern, setPattern] = useDebouncedString(
    config.sentinel?.pattern ?? '',
    (next) =>
      onPatch({
        ...config,
        sentinel: { ...(config.sentinel ?? { isRegex: false }), pattern: next },
      }),
  );
  const [cmd, setCmd] = useDebouncedString(config.command?.cmd ?? '', (next) =>
    onPatch({ ...config, command: { cmd: next } }),
  );
  const [rubric, setRubric] = useDebouncedString(
    config.judge?.rubric ?? '',
    (next) =>
      onPatch({
        ...config,
        judge: { ...(config.judge ?? {}), rubric: next },
      }),
  );
  const [model, setModel] = useDebouncedString(config.judge?.model ?? '', (next) =>
    onPatch({
      ...config,
      judge: { ...(config.judge ?? { rubric: '' }), model: next || undefined },
    }),
  );

  return (
    <>
      <Segmented<ConditionKind>
        label="Kind"
        value={kind}
        options={[
          { value: 'sentinel', label: 'Sentinel' },
          { value: 'command', label: 'Command' },
          { value: 'judge', label: 'Judge' },
        ]}
        onChange={(next) => onPatch({ ...config, kind: next })}
      />

      {kind === 'sentinel' && (
        <>
          <div className="field">
            <span className="field-label">Pattern</span>
            <input
              aria-label="Pattern"
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            />
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={config.sentinel?.isRegex ?? false}
              onChange={(e) =>
                onPatch({
                  ...config,
                  sentinel: {
                    pattern: config.sentinel?.pattern ?? '',
                    isRegex: e.target.checked,
                  },
                })
              }
            />
            <span>Treat as regex</span>
          </label>
        </>
      )}

      {kind === 'command' && (
        <div className="field">
          <span className="field-label">Command</span>
          <input
            aria-label="Command"
            type="text"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
          />
        </div>
      )}

      {kind === 'judge' && (
        <>
          <div className="field">
            <span className="field-label">Rubric</span>
            <textarea
              aria-label="Rubric"
              rows={4}
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
            />
          </div>
          <div className="field">
            <span className="field-label">Model</span>
            <input
              aria-label="Model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <span className="field-hint">blank = claude code default</span>
          </div>
        </>
      )}

      <div className="field">
        <span className="field-label">Against</span>
        <input
          aria-label="Against"
          type="text"
          value={against}
          placeholder="{{<previous-node>.stdout}}"
          onChange={(e) => setAgainst(e.target.value)}
        />
        <RefChips refs={refs} />
      </div>
    </>
  );
}

function LoopForm({
  config,
  onPatch,
}: {
  config: LoopConfig;
  onPatch: (next: LoopConfig) => void;
}) {
  const onMaxChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '') return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(100, Math.max(1, Math.floor(parsed)));
    onPatch({ ...config, maxIterations: clamped });
  };

  const infinite = config.infinite === true;

  return (
    <>
      <Segmented<'bounded' | 'infinite'>
        label="Iteration limit"
        value={infinite ? 'infinite' : 'bounded'}
        options={[
          { value: 'bounded', label: 'Bounded' },
          { value: 'infinite', label: 'Infinite ∞' },
        ]}
        onChange={(next) => onPatch({ ...config, infinite: next === 'infinite' })}
      />

      {!infinite && (
        <div className="field">
          <span className="field-label">Max iterations</span>
          <input
            aria-label="Max iterations"
            type="number"
            min={1}
            max={100}
            value={config.maxIterations ?? 5}
            onChange={onMaxChange}
          />
        </div>
      )}

      <Segmented<LoopConfig['mode']>
        label="Mode"
        value={config.mode ?? 'while-not-met'}
        options={[
          { value: 'while-not-met', label: 'While not met' },
          { value: 'unbounded', label: 'Unbounded' },
        ]}
        onChange={(next) => onPatch({ ...config, mode: next })}
      />
    </>
  );
}

function BranchForm({
  config,
  refs,
  onPatch,
}: {
  config: BranchConfig;
  refs: string[];
  onPatch: (next: BranchConfig) => void;
}) {
  const [lhs, setLhs] = useDebouncedString(config.lhs ?? '', (next) =>
    onPatch({ ...config, lhs: next }),
  );
  const [rhs, setRhs] = useDebouncedString(config.rhs ?? '', (next) =>
    onPatch({ ...config, rhs: next }),
  );
  const op: BranchOp = config.op ?? '==';

  return (
    <>
      <div className="field">
        <span className="field-label">Left</span>
        <input
          aria-label="Left"
          type="text"
          value={lhs}
          onChange={(e) => setLhs(e.target.value)}
          placeholder="{{claude-1.stdout}}"
        />
        <RefChips refs={refs} />
      </div>

      <Segmented<BranchOp>
        label="Operator"
        value={op}
        options={[
          { value: '==', label: '==' },
          { value: '!=', label: '!=' },
          { value: 'contains', label: 'contains' },
          { value: 'matches', label: 'matches' },
        ]}
        onChange={(next) => onPatch({ ...config, op: next })}
      />

      <div className="field">
        <span className="field-label">Right</span>
        <input
          aria-label="Right"
          type="text"
          value={rhs}
          onChange={(e) => setRhs(e.target.value)}
          placeholder={op === 'matches' ? '^DONE' : 'DONE'}
        />
        <RefChips refs={refs} />
      </div>
    </>
  );
}

/* ─── main component ───────────────────────────────────────── */

export default function ConfigPanel() {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const currentWorkflow = useWorkflowStore((s) => s.currentWorkflow);
  const updateNode = useWorkflowStore((s) => s.updateNode);

  const node = useMemo(
    () =>
      selectedNodeId && currentWorkflow
        ? findNode(currentWorkflow.nodes, selectedNodeId)
        : null,
    [selectedNodeId, currentWorkflow],
  );

  const refs = useMemo(
    () => (node ? availableRefs(currentWorkflow, node.id) : []),
    [currentWorkflow, node],
  );

  if (!node) {
    return (
      <aside aria-label="config panel" className="config-stub">
        <p className="config-empty">
          <span className="config-empty-prompt">›</span> select a node to
          configure<span className="crt-cursor" aria-hidden="true" />
        </p>
      </aside>
    );
  }

  const patchConfig = (nextConfig: WorkflowNode['config']) => {
    updateNode(node.id, { config: nextConfig });
  };

  return (
    <aside aria-label="config panel" className="config-stub">
      <header
        className="serif"
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 11,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--fg-soft)',
          marginBottom: 18,
        }}
      >
        {node.id} · {node.type}
      </header>

      <form className="task-form" onSubmit={(e) => e.preventDefault()}>
        {/* Display name applies to every node type — overrides the default
         * "START" / "CLAUDE" / etc. title on the canvas card. Empty value
         * (or whitespace) falls back to the type-default. */}
        <DisplayNameField
          key={node.id}
          value={node.label ?? ''}
          fallback={node.type.toUpperCase()}
          onCommit={(next) =>
            updateNode(node.id, {
              label: next.trim() ? next.trim() : undefined,
            })
          }
        />
        {node.type === 'start' && <StartForm />}
        {node.type === 'end' && (
          <EndForm
            config={node.config as EndConfig}
            onPatch={patchConfig}
          />
        )}
        {node.type === 'agent' && (
          <AgentForm
            config={node.config as AgentConfig}
            refs={refs}
            onPatch={patchConfig}
          />
        )}
        {node.type === 'condition' && (
          <ConditionForm
            config={node.config as ConditionConfig}
            refs={refs}
            onPatch={patchConfig}
          />
        )}
        {node.type === 'loop' && (
          <LoopForm
            config={node.config as LoopConfig}
            onPatch={patchConfig}
          />
        )}
        {node.type === 'branch' && (
          <BranchForm
            config={node.config as BranchConfig}
            refs={refs}
            onPatch={patchConfig}
          />
        )}
      </form>
    </aside>
  );
}
