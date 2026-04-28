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

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginBottom: 12,
};

const inputStyle: React.CSSProperties = {
  padding: 6,
  fontSize: 14,
};

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

    const cfg: RunConfig = {
      prompt,
      cwd,
      condition,
      maxIterations,
      iterationTimeoutMs,
    };

    onSubmit(cfg);
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="task form"
      style={{ maxWidth: 560 }}
    >
      <div style={fieldStyle}>
        <label htmlFor="tf-prompt">Prompt</label>
        <textarea
          id="tf-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          required
          rows={4}
          disabled={disabled}
          style={inputStyle}
        />
      </div>

      <div style={fieldStyle}>
        <label htmlFor="tf-cwd">Working directory (absolute path)</label>
        <input
          id="tf-cwd"
          type="text"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          required
          pattern="^/.*"
          placeholder="/absolute/path"
          disabled={disabled}
          style={inputStyle}
        />
      </div>

      <div style={fieldStyle}>
        <label htmlFor="tf-condition-type">Exit condition</label>
        <select
          id="tf-condition-type"
          value={conditionType}
          onChange={(e) =>
            setConditionType(e.target.value as ConditionType)
          }
          disabled={disabled}
          style={inputStyle}
        >
          <option value="sentinel">sentinel</option>
          <option value="command">command</option>
          <option value="judge">judge</option>
        </select>
      </div>

      {conditionType === 'sentinel' && (
        <>
          <div style={fieldStyle}>
            <label htmlFor="tf-pattern">Pattern</label>
            <input
              id="tf-pattern"
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              required
              disabled={disabled}
              style={inputStyle}
            />
          </div>
          <div style={fieldStyle}>
            <label htmlFor="tf-isregex">
              <input
                id="tf-isregex"
                type="checkbox"
                checked={isRegex}
                onChange={(e) => setIsRegex(e.target.checked)}
                disabled={disabled}
              />{' '}
              Treat pattern as regex
            </label>
          </div>
        </>
      )}

      {conditionType === 'command' && (
        <div style={fieldStyle}>
          <label htmlFor="tf-cmd">Command</label>
          <input
            id="tf-cmd"
            type="text"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            required
            disabled={disabled}
            style={inputStyle}
          />
        </div>
      )}

      {conditionType === 'judge' && (
        <>
          <div style={fieldStyle}>
            <label htmlFor="tf-rubric">Rubric</label>
            <textarea
              id="tf-rubric"
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
              required
              rows={3}
              disabled={disabled}
              style={inputStyle}
            />
          </div>
          <div style={fieldStyle}>
            <label htmlFor="tf-model">Model (optional)</label>
            <input
              id="tf-model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={disabled}
              style={inputStyle}
            />
          </div>
        </>
      )}

      <div style={fieldStyle}>
        <label htmlFor="tf-max-iter">Max iterations</label>
        <input
          id="tf-max-iter"
          type="number"
          min={1}
          max={100}
          value={maxIterations}
          onChange={(e) => setMaxIterations(Number(e.target.value))}
          required
          disabled={disabled}
          style={inputStyle}
        />
      </div>

      <div style={fieldStyle}>
        <label htmlFor="tf-iter-timeout">Iteration timeout (ms)</label>
        <input
          id="tf-iter-timeout"
          type="number"
          min={1000}
          value={iterationTimeoutMs}
          onChange={(e) => setIterationTimeoutMs(Number(e.target.value))}
          required
          disabled={disabled}
          style={inputStyle}
        />
      </div>

      <button type="submit" disabled={disabled} style={{ padding: '6px 12px' }}>
        Start run
      </button>
    </form>
  );
}
