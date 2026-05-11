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
import {
  Button,
  Checkbox,
  Input,
  Radio,
  RadioGroup,
  Textarea,
} from '@heroui/react';
import { useWorkflowStore } from '@/lib/client/workflow-store-client';
import FolderPicker from './FolderPicker';
import type { ProviderInfo } from '@/lib/server/providers/types';
import type {
  AgentConfig,
  BranchConfig,
  BranchOp,
  ConditionConfig,
  ConditionKind,
  EndConfig,
  JudgeNodeConfig,
  LoopConfig,
  ParallelConfig,
  ParallelMode,
  ParallelOnError,
  SubworkflowConfig,
  Workflow,
  WorkflowNode,
  WorkflowSummary,
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

/* ─── segmented control built on HeroUI RadioGroup ─────────── */
/* RadioGroup gives us proper accessibility (role="radiogroup" + role="radio"
 * children) for free; the classNames just compress the radios into a
 * pill/segment row visually. The data-selected attribute HeroUI puts on each
 * radio's base slot is what drives the "active" tint. */
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
    <RadioGroup
      label={label}
      orientation="horizontal"
      value={value}
      onValueChange={(next) => onChange(next as T)}
      classNames={{
        base: 'gap-1',
        label: 'text-fg-soft text-xs uppercase tracking-wider',
        wrapper: 'flex w-full gap-0 rounded-md border border-border bg-bg-deep p-0.5',
      }}
    >
      {options.map((opt) => (
        <Radio
          key={opt.value}
          value={opt.value}
          classNames={{
            base: [
              'm-0 max-w-none flex-1 justify-center',
              'cursor-pointer rounded px-3 py-1.5',
              'data-[selected=true]:bg-bg-elevated',
              'data-[selected=true]:text-fg',
              'data-[selected=true]:shadow-sm',
              'text-fg-dim hover:text-fg',
              'transition-colors',
            ].join(' '),
            wrapper: 'hidden',
            labelWrapper: 'm-0 p-0',
            label: 'text-sm',
          }}
        >
          {opt.label}
        </Radio>
      ))}
    </RadioGroup>
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
    <Input
      label="Display name"
      labelPlacement="outside"
      type="text"
      value={v}
      placeholder={fallback}
      onValueChange={setV}
      description="Shown on the canvas card. Leave blank to use the default."
    />
  );
}

/** Render the "Available refs: …" hint string for an Input's description prop.
 * Returns undefined when there are no refs so HeroUI hides the helper row. */
function refsHint(refs: string[]): string | undefined {
  if (refs.length === 0) return undefined;
  const prefix = refs.length === 1 ? 'Available ref: ' : 'Available refs: ';
  return prefix + refs.join('  ·  ');
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
  providerInfo,
  onPatch,
}: {
  config: AgentConfig;
  refs: string[];
  /** Provider metadata for `config.providerId`, fetched once at the panel
   * level. `null` while the panel-level fetch is in flight, or if the id
   * doesn't match any known provider. */
  providerInfo: ProviderInfo | null;
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
  const isHttpProvider = providerInfo?.transport === 'http';

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
      {/* Provider is read-only display, not a form field — but keeping the
       * label/value shape identical to the inputs below so the right-rail
       * forms read as a single column. */}
      <Input
        label="Provider"
        labelPlacement="outside"
        value={providerId}
        isReadOnly
        classNames={{ input: 'font-mono text-fg-soft' }}
      />

      {/* No Profile field for HTTP providers — each Hermes palette card
       * is already bound to a specific (host, port, model) tuple by the
       * `.hermes.local.json` connection it came from, so there's nothing
       * for the node author to override here. */}

      <Textarea
        label="Prompt"
        labelPlacement="outside"
        isRequired
        minRows={5}
        value={prompt}
        onValueChange={setPrompt}
        description={refsHint(refs)}
      />

      {!isHttpProvider && (
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
      )}

      {/* Iteration timeout: number input + unit segmented control. The unit
       * picker rides as endContent so it stays inside the Input's labeled
       * frame instead of fighting alignment in a separate row. */}
      <Input
        label="Iteration timeout"
        labelPlacement="outside"
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={String(timeoutDisplay)}
        onChange={onTimeoutChange}
        classNames={{ input: 'no-spin' }}
        endContent={
          <RadioGroup
            aria-label="Iteration timeout unit"
            orientation="horizontal"
            value={timeoutUnit}
            onValueChange={(next) => setTimeoutUnit(next as TimeoutUnit)}
            classNames={{
              base: 'gap-0 shrink-0',
              wrapper:
                'flex-nowrap gap-0 rounded-md border border-border bg-bg-input p-0.5',
            }}
          >
            {TIMEOUT_UNITS.map((u) => (
              <Radio
                key={u}
                value={u}
                classNames={{
                  base: [
                    'm-0 max-w-none shrink-0',
                    'cursor-pointer rounded px-2 py-0.5',
                    'data-[selected=true]:bg-bg-elevated',
                    'data-[selected=true]:text-fg',
                    'text-fg-soft hover:text-fg',
                  ].join(' '),
                  wrapper: 'hidden',
                  labelWrapper: 'm-0 p-0',
                  label: 'text-xs whitespace-nowrap',
                }}
              >
                {u}
              </Radio>
            ))}
          </RadioGroup>
        }
      />
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
          <Input
            label="Pattern"
            labelPlacement="outside"
            type="text"
            value={pattern}
            onValueChange={setPattern}
          />
          <Checkbox
            isSelected={config.sentinel?.isRegex ?? false}
            onValueChange={(checked) =>
              onPatch({
                ...config,
                sentinel: {
                  pattern: config.sentinel?.pattern ?? '',
                  isRegex: checked,
                },
              })
            }
          >
            Treat as regex
          </Checkbox>
        </>
      )}

      {kind === 'command' && (
        <Input
          label="Command"
          labelPlacement="outside"
          type="text"
          value={cmd}
          onValueChange={setCmd}
        />
      )}

      {kind === 'judge' && (
        <>
          <Textarea
            label="Rubric"
            labelPlacement="outside"
            minRows={4}
            value={rubric}
            onValueChange={setRubric}
          />
          <Input
            label="Model"
            labelPlacement="outside"
            type="text"
            value={model}
            onValueChange={setModel}
            description="blank = claude code default"
          />
        </>
      )}

      <Input
        label="Against"
        labelPlacement="outside"
        type="text"
        value={against}
        placeholder="{{<previous-node>.stdout}}"
        onValueChange={setAgainst}
        description={refsHint(refs)}
      />
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
        <Input
          label="Max iterations"
          labelPlacement="outside"
          type="number"
          min={1}
          max={100}
          value={String(config.maxIterations ?? 5)}
          onChange={onMaxChange}
        />
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
      <Input
        label="Left"
        labelPlacement="outside"
        type="text"
        value={lhs}
        onValueChange={setLhs}
        placeholder="{{claude-1.stdout}}"
        description={refsHint(refs)}
      />

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

      <Input
        label="Right"
        labelPlacement="outside"
        type="text"
        value={rhs}
        onValueChange={setRhs}
        placeholder={op === 'matches' ? '^DONE' : 'DONE'}
        description={refsHint(refs)}
      />
    </>
  );
}

/* ─── multi-agent forms (U4) ───────────────────────────────── */

function ParallelForm({
  config,
  onPatch,
}: {
  config: ParallelConfig;
  onPatch: (next: ParallelConfig) => void;
}) {
  const mode: ParallelMode = config.mode ?? 'wait-all';
  const onError: ParallelOnError = config.onError ?? 'fail-fast';

  // QuorumN's wire format is `number | undefined`. We carry a debounced string
  // mirror so the user can clear / edit without us snapping their cursor.
  const [quorumStr, setQuorumStr] = useDebouncedString(
    config.quorumN != null ? String(config.quorumN) : '',
    (next) => {
      const trimmed = next.trim();
      if (trimmed === '') {
        onPatch({ ...config, quorumN: undefined });
        return;
      }
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed) && parsed >= 1) {
        onPatch({ ...config, quorumN: Math.floor(parsed) });
      }
    },
  );

  return (
    <>
      <Segmented<ParallelMode>
        label="Mode"
        value={mode}
        options={[
          { value: 'wait-all', label: 'Wait all' },
          { value: 'race', label: 'Race' },
          { value: 'quorum', label: 'Quorum' },
        ]}
        onChange={(next) => onPatch({ ...config, mode: next })}
      />

      {mode === 'quorum' && (
        <Input
          label="Quorum N"
          labelPlacement="outside"
          type="number"
          min={1}
          value={quorumStr}
          onValueChange={setQuorumStr}
          description="1 ≤ quorumN ≤ children.length"
        />
      )}

      <Segmented<ParallelOnError>
        label="On error"
        value={onError}
        options={[
          { value: 'fail-fast', label: 'Fail-fast' },
          { value: 'best-effort', label: 'Best-effort' },
        ]}
        onChange={(next) => onPatch({ ...config, onError: next })}
      />
    </>
  );
}

/* ── shared dynamic key/value row helpers ─────────────────────
 * SubworkflowForm needs two near-identical "name → templated string" grids
 * (inputs and outputs). They differ only in the label/description on the
 * value field. We keep a local rowId so React can identify rows across
 * renames without re-mounting their inputs (which would lose focus). */
interface KvRowData {
  rowId: string;
  name: string;
  value: string;
}

function recordToRows(
  rec: Record<string, string> | undefined,
): KvRowData[] {
  if (!rec) return [];
  return Object.entries(rec).map(([name, value], i) => ({
    rowId: `r-${i}-${name}`,
    name,
    value,
  }));
}

/** Drop empty-name rows on commit and let later duplicates win — matches the
 * normal "last write wins" Record semantics so renames behave predictably. */
function rowsToRecord(rows: KvRowData[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.name.trim();
    if (!key) continue;
    out[key] = row.value;
  }
  return out;
}

function nextRowId(): string {
  // Date.now is fine — rows are appended one at a time on user click.
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

interface KvRowsEditorProps {
  rows: KvRowData[];
  onChange: (next: KvRowData[]) => void;
  nameLabel: string;
  valueLabel: string;
  valuePlaceholder?: string;
  valueDescription?: string;
  addLabel: string;
}

/* Per-row component so each cell carries its own debounced text buffer —
 * keystrokes don't slam the workflow store / undo history. */
function KvRow({
  row,
  index,
  isLast,
  nameLabel,
  valueLabel,
  valuePlaceholder,
  valueDescription,
  onCommit,
  onRemove,
}: {
  row: KvRowData;
  index: number;
  isLast: boolean;
  nameLabel: string;
  valueLabel: string;
  valuePlaceholder?: string;
  valueDescription?: string;
  onCommit: (patch: Partial<KvRowData>) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useDebouncedString(row.name, (next) =>
    onCommit({ name: next }),
  );
  const [value, setValue] = useDebouncedString(row.value, (next) =>
    onCommit({ value: next }),
  );
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr auto',
        gap: 8,
        alignItems: 'flex-start',
      }}
    >
      <Input
        aria-label={`${nameLabel} ${index}`}
        type="text"
        size="sm"
        value={name}
        onValueChange={setName}
        placeholder={nameLabel}
      />
      <Input
        aria-label={`${valueLabel} ${index}`}
        type="text"
        size="sm"
        value={value}
        onValueChange={setValue}
        placeholder={valuePlaceholder}
        description={isLast ? valueDescription : undefined}
      />
      <Button
        size="sm"
        variant="light"
        onPress={onRemove}
        aria-label={`remove ${nameLabel} ${index}`}
      >
        ✕
      </Button>
    </div>
  );
}

function KvRowsEditor({
  rows,
  onChange,
  nameLabel,
  valueLabel,
  valuePlaceholder,
  valueDescription,
  addLabel,
}: KvRowsEditorProps) {
  const updateRow = (rowId: string, patch: Partial<KvRowData>) => {
    onChange(
      rows.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)),
    );
  };
  const removeRow = (rowId: string) => {
    onChange(rows.filter((r) => r.rowId !== rowId));
  };
  const addRow = () => {
    onChange([...rows, { rowId: nextRowId(), name: '', value: '' }]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((row, i) => (
        <KvRow
          key={row.rowId}
          row={row}
          index={i}
          isLast={i === rows.length - 1}
          nameLabel={nameLabel}
          valueLabel={valueLabel}
          valuePlaceholder={valuePlaceholder}
          valueDescription={valueDescription}
          onCommit={(patch) => updateRow(row.rowId, patch)}
          onRemove={() => removeRow(row.rowId)}
        />
      ))}
      <Button
        size="sm"
        variant="flat"
        onPress={addRow}
        style={{ alignSelf: 'flex-start' }}
      >
        + {addLabel}
      </Button>
    </div>
  );
}

function SubworkflowForm({
  config,
  onPatch,
}: {
  config: SubworkflowConfig;
  onPatch: (next: SubworkflowConfig) => void;
}) {
  const currentWorkflowId = useWorkflowStore(
    (s) => s.currentWorkflow?.id ?? null,
  );

  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/workflows')
      .then((r) => r.json())
      .then((data: { workflows?: WorkflowSummary[] }) => {
        if (!cancelled && Array.isArray(data.workflows)) {
          setWorkflows(data.workflows);
        }
      })
      .catch((err: unknown) => {
        console.warn('[subworkflow-form] failed to load workflows:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Local rows carry stable rowIds so cell text edits don't re-key the entry
  // on every keystroke. We re-sync from upstream when the parent-provided
  // record reference changes (only happens on node-switch / undo / external
  // mutation — our own commits assign the ref ourselves so we skip).
  const [inputRows, setInputRows] = useState<KvRowData[]>(() =>
    recordToRows(config.inputs),
  );
  const [outputRows, setOutputRows] = useState<KvRowData[]>(() =>
    recordToRows(config.outputs),
  );
  const lastInputs = useRef(config.inputs);
  const lastOutputs = useRef(config.outputs);
  useEffect(() => {
    if (config.inputs !== lastInputs.current) {
      lastInputs.current = config.inputs;
      setInputRows(recordToRows(config.inputs));
    }
  }, [config.inputs]);
  useEffect(() => {
    if (config.outputs !== lastOutputs.current) {
      lastOutputs.current = config.outputs;
      setOutputRows(recordToRows(config.outputs));
    }
  }, [config.outputs]);

  const commitInputs = (rows: KvRowData[]) => {
    setInputRows(rows);
    const rec = rowsToRecord(rows);
    lastInputs.current = rec;
    onPatch({ ...config, inputs: rec });
  };
  const commitOutputs = (rows: KvRowData[]) => {
    setOutputRows(rows);
    const rec = rowsToRecord(rows);
    lastOutputs.current = rec;
    onPatch({ ...config, outputs: rec });
  };

  const onWorkflowChange = (e: ChangeEvent<HTMLSelectElement>) => {
    onPatch({ ...config, workflowId: e.target.value });
  };

  // Hide self-reference; cycle detection beyond direct self lives in the
  // engine. If currentWorkflowId is null (e.g. unsaved), just show all.
  const choices = workflows.filter((w) => w.id !== currentWorkflowId);

  return (
    <>
      <div className="field">
        <span className="field-label">Workflow</span>
        <select value={config.workflowId ?? ''} onChange={onWorkflowChange}>
          <option value="">(none — pick a workflow)</option>
          {choices.map((w) => (
            <option key={w.id} value={w.id}>
              {w.id} ({w.name})
              {w.source === 'library' ? ' [library]' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <span className="field-label">Inputs</span>
        <KvRowsEditor
          rows={inputRows}
          onChange={commitInputs}
          nameLabel="name"
          valueLabel="value template"
          valuePlaceholder="{{claude-1.stdout}}"
          addLabel="add input"
        />
      </div>

      <div className="field">
        <span className="field-label">Outputs</span>
        <KvRowsEditor
          rows={outputRows}
          onChange={commitOutputs}
          nameLabel="name"
          valueLabel="child path"
          valuePlaceholder="judge-1.winner"
          valueDescription={
            'dotted path into the child workflow\'s terminal scope, e.g. "judge-1.winner"'
          }
          addLabel="add output"
        />
      </div>
    </>
  );
}

/* ── one judge-candidate textarea row ──────────────────────────
 * Pulled out so each candidate's debounced string state stays anchored to
 * its own row identity — otherwise reordering or removing a row would
 * scramble the in-flight buffers. */
function CandidateRow({
  index,
  value,
  onCommit,
  onRemove,
}: {
  index: number;
  value: string;
  onCommit: (next: string) => void;
  onRemove: () => void;
}) {
  const [v, setV] = useDebouncedString(value, onCommit);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 11,
            color: 'var(--fg-soft)',
            letterSpacing: '0.1em',
          }}
        >
          [{index}]
        </span>
        <Button
          type="button"
          size="sm"
          variant="light"
          onPress={onRemove}
          aria-label={`remove candidate ${index}`}
        >
          remove
        </Button>
      </div>
      <Textarea
        aria-label={`candidate ${index}`}
        minRows={2}
        value={v}
        onValueChange={setV}
      />
    </div>
  );
}

function JudgeForm({
  config,
  refs,
  onPatch,
}: {
  config: JudgeNodeConfig;
  refs: string[];
  onPatch: (next: JudgeNodeConfig) => void;
}) {
  const [criteria, setCriteria] = useDebouncedString(
    config.criteria ?? '',
    (next) => onPatch({ ...config, criteria: next }),
  );
  const [judgePrompt, setJudgePrompt] = useDebouncedString(
    config.judgePrompt ?? '',
    (next) =>
      onPatch({
        ...config,
        judgePrompt: next.length > 0 ? next : undefined,
      }),
  );
  const [model, setModel] = useDebouncedString(config.model ?? '', (next) =>
    onPatch({ ...config, model: next.length > 0 ? next : undefined }),
  );
  const [providerId, setProviderId] = useDebouncedString(
    config.providerId ?? '',
    (next) =>
      onPatch({
        ...config,
        providerId: next.length > 0 ? next : undefined,
      }),
  );

  // judgePrompt is collapsed by default; the checkbox is the user-facing
  // commit point. Toggling off clears the override; toggling on opens an
  // empty textarea (the user-typed value is lost on collapse — that's
  // intentional, since "override off" means "use the default").
  const [overridePrompt, setOverridePrompt] = useState<boolean>(
    () => (config.judgePrompt ?? '').length > 0,
  );

  const candidates = config.candidates ?? [];

  const updateCandidate = (idx: number, next: string) => {
    const arr = candidates.slice();
    arr[idx] = next;
    onPatch({ ...config, candidates: arr });
  };
  const removeCandidate = (idx: number) => {
    const arr = candidates.slice();
    arr.splice(idx, 1);
    onPatch({ ...config, candidates: arr });
  };
  const addCandidate = () => {
    onPatch({ ...config, candidates: [...candidates, ''] });
  };

  return (
    <>
      <Textarea
        label="Criteria"
        labelPlacement="outside"
        minRows={4}
        value={criteria}
        onValueChange={setCriteria}
        description={refsHint(refs)}
      />

      <div className="field">
        <span className="field-label">Candidates</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {candidates.map((c, i) => (
            // Index-keyed: useDebouncedString re-syncs when the upstream
            // value reference changes, so focus on unaffected rows is
            // preserved when another row is added or removed.
            <CandidateRow
              key={i}
              index={i}
              value={c}
              onCommit={(next) => updateCandidate(i, next)}
              onRemove={() => removeCandidate(i)}
            />
          ))}
          <Button
            type="button"
            size="sm"
            variant="flat"
            onPress={addCandidate}
            style={{ alignSelf: 'flex-start' }}
          >
            + add candidate
          </Button>
        </div>
      </div>

      <Checkbox
        isSelected={overridePrompt}
        onValueChange={(checked) => {
          setOverridePrompt(checked);
          if (!checked) {
            // Clear both the local buffer and the stored override so the
            // engine falls back to the provider default.
            setJudgePrompt('');
            onPatch({ ...config, judgePrompt: undefined });
          }
        }}
      >
        Override judge prompt
      </Checkbox>

      {overridePrompt && (
        <Textarea
          label="Judge prompt"
          labelPlacement="outside"
          minRows={4}
          value={judgePrompt}
          onValueChange={setJudgePrompt}
        />
      )}

      <Input
        label="Model"
        labelPlacement="outside"
        type="text"
        value={model}
        onValueChange={setModel}
        description="blank = provider default"
      />

      <Input
        label="Provider"
        labelPlacement="outside"
        type="text"
        value={providerId}
        placeholder="claude"
        onValueChange={setProviderId}
      />
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

  // Provider list is needed by AgentForm to decide whether to show the
  // profile dropdown. We fetch it once at the panel level (instead of
  // per-AgentForm-mount) so a rapid provider switch can't race two separate
  // fetches mid-render. /api/providers is in-process cached on the server.
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/providers')
      .then((r) => r.json())
      .then((data: { providers?: ProviderInfo[] }) => {
        if (!cancelled && Array.isArray(data.providers)) {
          setProviders(data.providers);
        }
      })
      .catch((err: unknown) => {
        console.warn('[config-panel] failed to load providers:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
            providerInfo={
              providers.find(
                (p) => p.id === ((node.config as AgentConfig).providerId ?? 'claude'),
              ) ?? null
            }
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
        {node.type === 'parallel' && (
          <ParallelForm
            config={node.config as ParallelConfig}
            onPatch={patchConfig}
          />
        )}
        {node.type === 'subworkflow' && (
          <SubworkflowForm
            config={node.config as SubworkflowConfig}
            onPatch={patchConfig}
          />
        )}
        {node.type === 'judge' && (
          <JudgeForm
            config={node.config as JudgeNodeConfig}
            refs={refs}
            onPatch={patchConfig}
          />
        )}
      </form>
    </aside>
  );
}
