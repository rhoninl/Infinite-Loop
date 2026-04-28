'use client';

import { useState, type FormEvent } from 'react';
import type {
  ConditionSpec,
  ConditionType,
  RunConfig,
} from '../../lib/shared/types';

export interface TaskFormProps {
  disabled?: boolean;
  onSubmit: (cfg: RunConfig) => void;
}

const CONDITION_HINT: Record<ConditionType, string> = {
  sentinel: 'matches text in stdout',
  command: 'shell exits 0',
  judge: 'a second claude call decides',
};

const CONDITION_OPTIONS: Array<{
  value: ConditionType;
  label: string;
  sub: string;
}> = [
  { value: 'sentinel', label: 'sentinel', sub: 'text match' },
  { value: 'command', label: 'command', sub: 'shell exit' },
  { value: 'judge', label: 'judge', sub: 'llm verdict' },
];

export default function TaskForm(props: TaskFormProps) {
  const { disabled = false, onSubmit } = props;

  const [prompt, setPrompt] = useState('');
  const [cwd, setCwd] = useState('');
  const [conditionType, setConditionType] = useState<ConditionType>('sentinel');
  const [pattern, setPattern] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [cmd, setCmd] = useState('');
  const [rubric, setRubric] = useState('');
  const [model, setModel] = useState('');
  const [maxIterations, setMaxIterations] = useState(5);
  const [iterationTimeoutMs, setIterationTimeoutMs] = useState(60000);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (disabled) return;

    if (!prompt.trim()) return;
    if (!cwd.trim() || !cwd.startsWith('/')) return;

    let condition: ConditionSpec;
    if (conditionType === 'sentinel') {
      if (!pattern.trim()) return;
      condition = { type: 'sentinel', config: { pattern, isRegex } };
    } else if (conditionType === 'command') {
      if (!cmd.trim()) return;
      condition = { type: 'command', config: { cmd } };
    } else {
      if (!rubric.trim()) return;
      condition = {
        type: 'judge',
        config: model.trim() ? { rubric, model } : { rubric },
      };
    }

    onSubmit({
      prompt,
      cwd,
      condition,
      maxIterations,
      iterationTimeoutMs,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="task form"
      className="task-form crosshair"
    >
      <div className="field">
        <div className="field-head">
          <label className="field-label" htmlFor="tf-prompt">
            Prompt
          </label>
          <span className="field-hint">what claude should do</span>
        </div>
        <textarea
          id="tf-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          required
          rows={5}
          disabled={disabled}
          placeholder="write hello.txt with contents 'hi'"
        />
      </div>

      <div className="field">
        <div className="field-head">
          <label className="field-label" htmlFor="tf-cwd">
            Working directory
          </label>
          <span className="field-hint">absolute path</span>
        </div>
        <input
          id="tf-cwd"
          type="text"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          required
          pattern="^/.*"
          placeholder="/Users/you/project"
          disabled={disabled}
        />
      </div>

      <div className="field">
        <div className="field-head">
          <span className="field-label" id="tf-condition-type-label">
            Exit condition
          </span>
          <span className="field-hint">{CONDITION_HINT[conditionType]}</span>
        </div>
        <div
          className="segmented"
          role="radiogroup"
          aria-label="Exit condition"
        >
          {CONDITION_OPTIONS.map((opt) => {
            const active = opt.value === conditionType;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                data-active={active}
                data-value={opt.value}
                onClick={() => setConditionType(opt.value)}
                disabled={disabled}
              >
                <span className="seg-label">{opt.label}</span>
                <span className="seg-sub">{opt.sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      {conditionType === 'sentinel' && (
        <>
          <div className="field">
            <div className="field-head">
              <label className="field-label" htmlFor="tf-pattern">
                Pattern
              </label>
            </div>
            <input
              id="tf-pattern"
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              required
              disabled={disabled}
              placeholder="DONE"
            />
          </div>
          <label className="checkbox-row" htmlFor="tf-isregex">
            <input
              id="tf-isregex"
              type="checkbox"
              checked={isRegex}
              onChange={(e) => setIsRegex(e.target.checked)}
              disabled={disabled}
            />
            <span>Treat pattern as regex</span>
          </label>
        </>
      )}

      {conditionType === 'command' && (
        <div className="field">
          <div className="field-head">
            <label className="field-label" htmlFor="tf-cmd">
              Command
            </label>
            <span className="field-hint">runs in cwd</span>
          </div>
          <input
            id="tf-cmd"
            type="text"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            required
            disabled={disabled}
            placeholder="test -f hello.txt"
          />
        </div>
      )}

      {conditionType === 'judge' && (
        <>
          <div className="field">
            <div className="field-head">
              <label className="field-label" htmlFor="tf-rubric">
                Rubric
              </label>
              <span className="field-hint">judge prompt</span>
            </div>
            <textarea
              id="tf-rubric"
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
              required
              rows={3}
              disabled={disabled}
              placeholder="Did the assistant create the file?"
            />
          </div>
          <div className="field">
            <div className="field-head">
              <label className="field-label" htmlFor="tf-model">
                Model
              </label>
              <span className="field-hint">
                optional · blank = claude code default
              </span>
            </div>
            <input
              id="tf-model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={disabled}
              placeholder="(claude code default)"
            />
          </div>
        </>
      )}

      <div className="field-row">
        <div className="field">
          <div className="field-head">
            <label className="field-label" htmlFor="tf-max-iter">
              Max iterations
            </label>
          </div>
          <input
            id="tf-max-iter"
            type="number"
            min={1}
            max={100}
            value={maxIterations}
            onChange={(e) => setMaxIterations(Number(e.target.value))}
            required
            disabled={disabled}
          />
        </div>
        <div className="field">
          <div className="field-head">
            <label className="field-label" htmlFor="tf-iter-timeout">
              Iteration timeout (ms)
            </label>
          </div>
          <input
            id="tf-iter-timeout"
            type="number"
            min={1000}
            value={iterationTimeoutMs}
            onChange={(e) => setIterationTimeoutMs(Number(e.target.value))}
            required
            disabled={disabled}
          />
        </div>
      </div>

      <button type="submit" disabled={disabled} className="btn">
        Start run
      </button>
    </form>
  );
}
