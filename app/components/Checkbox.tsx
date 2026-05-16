'use client';

import { useId } from 'react';

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
}

/** Styled checkbox that replaces native `<input type="checkbox">` for
 *  primary UI controls. The visual is a CSS-styled box driven off the
 *  `[data-checked]` attribute on a button; an aria role of "checkbox"
 *  keeps it accessible to screen readers and keyboard navigation (Space
 *  toggles, as on a native checkbox). When `label` is provided the box
 *  and label compose as a single click target. */
export default function Checkbox({
  checked,
  onChange,
  ariaLabel,
  label,
  disabled = false,
  className,
}: Props) {
  const id = useId();
  const classes = ['checkbox', className].filter(Boolean).join(' ');
  const box = (
    <button
      type="button"
      role="checkbox"
      id={id}
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      disabled={disabled}
      className="checkbox-box"
      data-checked={checked}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onChange(!checked);
        }
      }}
    >
      <span className="checkbox-mark" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
    </button>
  );
  if (!label) return <span className={classes}>{box}</span>;
  return (
    <label className={classes} htmlFor={id}>
      {box}
      <span className="checkbox-label">{label}</span>
    </label>
  );
}
