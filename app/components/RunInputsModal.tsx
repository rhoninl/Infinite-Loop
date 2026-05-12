'use client';

import { useState, type FormEvent } from 'react';
import type { WorkflowInputDecl } from '@/lib/shared/workflow';
import {
  resolveRunInputs,
  WorkflowInputError,
  type WorkflowInputValue,
} from '@/lib/shared/resolve-run-inputs';

interface Props {
  declared: WorkflowInputDecl[];
  onSubmit: (values: Record<string, WorkflowInputValue>) => void;
  onCancel: () => void;
}

type FieldValue = string | number | boolean | undefined;

export default function RunInputsModal({ declared, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<Record<string, FieldValue>>(() => {
    const initial: Record<string, FieldValue> = {};
    for (const d of declared) {
      initial[d.name] = d.default;
    }
    return initial;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const supplied: Record<string, WorkflowInputValue> = {};
    for (const d of declared) {
      const v = values[d.name];
      if (v !== undefined && v !== '') supplied[d.name] = v as WorkflowInputValue;
    }
    try {
      const resolved = resolveRunInputs(declared, supplied);
      setErrors({});
      onSubmit(resolved);
    } catch (err) {
      if (err instanceof WorkflowInputError) {
        const msg =
          err.reason === 'required'
            ? 'required'
            : `expected ${err.expected}`;
        setErrors({ [err.field]: msg });
        return;
      }
      throw err;
    }
  };

  return (
    <div
      role="dialog"
      aria-label="workflow inputs"
      className="modal-backdrop"
    >
      <form className="modal" onSubmit={handleSubmit}>
        <h2>Run with inputs</h2>
        {declared.map((d) => (
          <div key={d.name} className="field">
            <label htmlFor={`run-input-${d.name}`}>{d.name}</label>
            {d.description && (
              <p className="field-hint">{d.description}</p>
            )}
            <FieldWidget
              id={`run-input-${d.name}`}
              decl={d}
              value={values[d.name]}
              onChange={(v) => setValues((s) => ({ ...s, [d.name]: v }))}
            />
            {errors[d.name] && (
              <p className="field-error">{errors[d.name]}</p>
            )}
          </div>
        ))}
        <div className="modal-actions">
          <button type="button" className="btn btn-toggle" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn">
            Run
          </button>
        </div>
      </form>
    </div>
  );
}

function FieldWidget({
  id,
  decl,
  value,
  onChange,
}: {
  id: string;
  decl: WorkflowInputDecl;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
}) {
  switch (decl.type) {
    case 'string':
      return (
        <input
          id={id}
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      );
    case 'text':
      return (
        <textarea
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      );
    case 'number':
      return (
        <input
          id={id}
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange(undefined);
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : undefined);
          }}
        />
      );
    case 'boolean':
      return (
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
  }
}
