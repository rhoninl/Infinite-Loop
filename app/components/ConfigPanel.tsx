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
  SidenoteConfig,
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

function SidenoteForm({
  config,
  onPatch,
}: {
  config: SidenoteConfig;
  onPatch: (next: SidenoteConfig) => void;
}) {
  const [text, setText] = useDebouncedString(config.text ?? '', (next) =>
    onPatch({ ...config, text: next }),
  );
  return (
    <div className="field">
      <span className="field-label">Note</span>
      <textarea
        aria-label="Note text"
        rows={6}
        value={text}
        placeholder="Write a free-form note — pinned to the canvas, not run by the engine."
        onChange={(e) => setText(e.target.value)}
      />
      <span className="field-hint">
        Static text. No templating, no execution — purely for documentation.
      </span>
    </div>
  );
}

/** Mirror of the server-side CliAgent shape (kept local so the client
 * doesn't import from `lib/server/...`). Only `name` is required by the
 * UI; the rest decorates the dropdown option text. */
interface AgentChoice {
  name: string;
  model?: string;
  group?: 'user' | 'project' | 'builtin';
}

/**
 * Custom-styled agent picker. Wraps a free-text input with a popover list
 * of discovered agents — terminal-aesthetic, not the browser's native
 * `<datalist>` (which renders inconsistently across browsers and breaks
 * the visual language of the rest of the app). The user can still type
 * a name that isn't in the list.
 */
function AgentPicker({
  value,
  onChange,
  choices,
}: {
  value: string;
  onChange: (next: string) => void;
  choices: AgentChoice[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Esc, but only while open. We listen in capture
  // phase so xyflow / global handlers can't swallow the event before us.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const root = wrapRef.current;
      if (!root) return;
      if (!root.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Filter against the current input value (case-insensitive substring),
  // keeping the original order so users see groups clustered as the CLI
  // returned them.
  const needle = value.trim().toLowerCase();
  const filtered = needle.length
    ? choices.filter((a) => a.name.toLowerCase().includes(needle))
    : choices;

  return (
    <div ref={wrapRef} className="agent-picker">
      <input
        aria-label="Agent"
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder="(optional — leave blank for default)"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
      />
      {open && filtered.length > 0 && (
        <ul role="listbox" aria-label="Available agents" className="agent-picker-panel">
          {filtered.map((a) => {
            const groupLabel =
              a.group === 'user'
                ? 'user'
                : a.group === 'project'
                  ? 'project'
                  : a.group === 'builtin'
                    ? 'built-in'
                    : '';
            const meta = [groupLabel, a.model].filter(Boolean).join(' · ');
            return (
              <li key={a.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={a.name === value}
                  className="agent-picker-row"
                  onMouseDown={(e) => {
                    // mousedown (not click) so the input's blur doesn't fire
                    // first and unmount the panel before the click lands.
                    e.preventDefault();
                    onChange(a.name);
                    setOpen(false);
                  }}
                >
                  <span className="agent-picker-name">{a.name}</span>
                  {meta && <span className="agent-picker-meta">{meta}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Custom single-select dropdown — used in places where a native `<select>`
 * would be visually inconsistent with the rest of the terminal UI. Reads
 * as a button + popover, same family as AgentPicker and wf-menu.
 */
function WorkflowPicker({
  value,
  choices,
  onChange,
}: {
  value: string;
  choices: WorkflowSummary[];
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const root = wrapRef.current;
      if (root && !root.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = value ? choices.find((c) => c.id === value) : null;
  const buttonLabel = selected
    ? `${selected.id} (${selected.name})${selected.source === 'library' ? ' [library]' : ''}`
    : '(none — pick a workflow)';

  return (
    <div ref={wrapRef} className="agent-picker">
      <button
        type="button"
        className="custom-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={selected ? 'custom-select-value' : 'custom-select-placeholder'}
        >
          {buttonLabel}
        </span>
        <span className="custom-select-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Available workflows"
          className="agent-picker-panel"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={value === ''}
              className="agent-picker-row"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange('');
                setOpen(false);
              }}
            >
              <span className="agent-picker-name">(none)</span>
              <span className="agent-picker-meta">clear</span>
            </button>
          </li>
          {choices.length === 0 && (
            <li>
              <div className="agent-picker-row" style={{ cursor: 'default' }}>
                <span className="agent-picker-meta">no other workflows</span>
              </div>
            </li>
          )}
          {choices.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                role="option"
                aria-selected={value === w.id}
                className="agent-picker-row"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(w.id);
                  setOpen(false);
                }}
              >
                <span className="agent-picker-name">{w.id}</span>
                <span className="agent-picker-meta">
                  {[w.name, w.source === 'library' ? 'library' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const [agent, setAgent] = useDebouncedString(config.agent ?? '', (next) =>
    onPatch({ ...config, agent: next.trim() ? next.trim() : undefined }),
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

  // Fetch the CLI provider's available agents so the Agent field can
  // suggest them. The cwd is part of the probe because `claude agents`
  // resolves project-scoped agents from the working directory's settings
  // stack — change the cwd, and the listing changes too. When the new
  // listing no longer contains the currently-selected agent (a project-
  // level agent from the old directory), we clear the field so the user
  // has to re-pick; built-in / user-global agents survive the change.
  const [agentChoices, setAgentChoices] = useState<AgentChoice[]>([]);
  useEffect(() => {
    if (isHttpProvider) {
      setAgentChoices([]);
      return;
    }
    // Only probe once an absolute cwd is set; relative cwds would resolve
    // against the server, not the workflow's intended directory.
    if (!cwd || !cwd.startsWith('/')) {
      setAgentChoices([]);
      return;
    }
    let cancelled = false;
    fetch(
      `/api/providers/${encodeURIComponent(providerId)}/agents?cwd=${encodeURIComponent(cwd)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { agents?: AgentChoice[] } | null) => {
        if (cancelled || !data || !Array.isArray(data.agents)) return;
        setAgentChoices(data.agents);
        const current = (config.agent ?? '').trim();
        if (
          current.length > 0 &&
          data.agents.length > 0 &&
          !data.agents.some((a) => a.name === current)
        ) {
          // The previously-selected agent doesn't exist in the new cwd's
          // listing. Clear it so the user has to re-select.
          setAgent('');
          onPatch({ ...config, agent: undefined });
        }
      })
      .catch(() => {
        // Silent: not every CLI provider exposes a listing. The input still works.
      });
    return () => {
      cancelled = true;
    };
    // We intentionally exclude `config` and `onPatch` from deps: this effect
    // is keyed to the (providerId, cwd, transport) triplet — re-running it
    // on every config keystroke would thrash. We read `config.agent` once
    // when the new listing arrives, which is the only place it's needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, isHttpProvider, cwd]);

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

      {/* No Profile field for HTTP providers — each Hermes palette card
       * is already bound to a specific (host, port, model) tuple by the
       * `.hermes.local.json` connection it came from, so there's nothing
       * for the node author to override here. */}

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

      {!isHttpProvider && (
        <div className="field">
          <span className="field-label">Agent</span>
          <AgentPicker
            value={agent}
            onChange={setAgent}
            choices={agentChoices}
          />
          <span className="field-hint">
            Adds <code>--agent &lt;name&gt;</code> to the spawned command. Leave blank to omit the flag.
          </span>
        </div>
      )}

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
        <div className="field">
          <span className="field-label">Quorum N</span>
          <input
            aria-label="Quorum N"
            type="number"
            min={1}
            value={quorumStr}
            onChange={(e) => setQuorumStr(e.target.value)}
          />
          <span className="field-hint">1 ≤ quorumN ≤ children.length</span>
        </div>
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
      <input
        aria-label={`${nameLabel} ${index}`}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={nameLabel}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <input
          aria-label={`${valueLabel} ${index}`}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={valuePlaceholder}
        />
        {isLast && valueDescription ? (
          <span className="field-hint">{valueDescription}</span>
        ) : null}
      </div>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onRemove}
        aria-label={`remove ${nameLabel} ${index}`}
      >
        ✕
      </button>
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
      <button
        type="button"
        className="btn btn-ghost"
        onClick={addRow}
        style={{ alignSelf: 'flex-start' }}
      >
        + {addLabel}
      </button>
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

  // Hide self-reference; cycle detection beyond direct self lives in the
  // engine. If currentWorkflowId is null (e.g. unsaved), just show all.
  const choices = workflows.filter((w) => w.id !== currentWorkflowId);

  return (
    <>
      <div className="field">
        <span className="field-label">Workflow</span>
        <WorkflowPicker
          value={config.workflowId ?? ''}
          choices={choices}
          onChange={(next) => onPatch({ ...config, workflowId: next })}
        />
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
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onRemove}
          aria-label={`remove candidate ${index}`}
        >
          remove
        </button>
      </div>
      <textarea
        aria-label={`candidate ${index}`}
        rows={2}
        value={v}
        onChange={(e) => setV(e.target.value)}
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
      <div className="field">
        <span className="field-label">Criteria</span>
        <textarea
          aria-label="Criteria"
          rows={4}
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
        />
        <RefChips refs={refs} />
      </div>

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
          <button
            type="button"
            className="btn btn-ghost"
            onClick={addCandidate}
            style={{ alignSelf: 'flex-start' }}
          >
            + add candidate
          </button>
        </div>
      </div>

      <label className="field-checkbox">
        <input
          type="checkbox"
          checked={overridePrompt}
          onChange={(e) => {
            const checked = e.target.checked;
            setOverridePrompt(checked);
            if (!checked) {
              // Clear both the local buffer and the stored override so the
              // engine falls back to the provider default.
              setJudgePrompt('');
              onPatch({ ...config, judgePrompt: undefined });
            }
          }}
        />
        <span>Override judge prompt</span>
      </label>

      {overridePrompt && (
        <div className="field">
          <span className="field-label">Judge prompt</span>
          <textarea
            aria-label="Judge prompt"
            rows={4}
            value={judgePrompt}
            onChange={(e) => setJudgePrompt(e.target.value)}
          />
        </div>
      )}

      <div className="field">
        <span className="field-label">Model</span>
        <input
          aria-label="Model"
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <span className="field-hint">blank = provider default</span>
      </div>

      <div className="field">
        <span className="field-label">Provider</span>
        <input
          aria-label="Provider"
          type="text"
          value={providerId}
          placeholder="claude"
          onChange={(e) => setProviderId(e.target.value)}
        />
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
        {node.type === 'sidenote' && (
          <SidenoteForm
            config={node.config as SidenoteConfig}
            onPatch={patchConfig}
          />
        )}
      </form>
    </aside>
  );
}
