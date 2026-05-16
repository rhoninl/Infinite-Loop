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
 *  and label compose as a single click target — using a <span> wrapper
 *  with a forwarded onClick (NOT <label htmlFor>) to avoid the
 *  historical browser quirk where a <button> inside <label> can
 *  double-fire on label-text click. */
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
  const toggle = () => { if (!disabled) onChange(!checked); };
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
      onClick={(e) => {
        // Stop propagation so the wrapper span's onClick (when label is
        // provided) doesn't also toggle — that would un-toggle the box.
        e.stopPropagation();
        toggle();
      }}
      onKeyDown={(e) => {
        // Native <button> already fires `click` on Space and Enter, so
        // we only intercept Space to suppress the default page-scroll.
        if (e.key === ' ') e.preventDefault();
      }}
    >
      <span className="checkbox-mark" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
    </button>
  );
  if (!label) return <span className={classes}>{box}</span>;
  return (
    <span className={classes} onClick={toggle}>
      {box}
      <span className="checkbox-label">{label}</span>
    </span>
  );
}
