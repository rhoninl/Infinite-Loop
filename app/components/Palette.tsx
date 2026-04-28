'use client';

import type { NodeType } from '@/lib/shared/workflow';

const DRAG_MIME = 'application/x-infloop-node';

interface PaletteItem {
  type: NodeType;
  name: string;
  glyph: string;
  description: string;
}

interface PaletteCategory {
  heading: string;
  items: PaletteItem[];
}

const CATEGORIES: PaletteCategory[] = [
  {
    heading: 'Control',
    items: [
      { type: 'start', name: 'Start', glyph: '◇', description: 'begin a workflow' },
      { type: 'end', name: 'End', glyph: '◆', description: 'settle the run' },
      { type: 'loop', name: 'Loop', glyph: '↻', description: 'repeat until met' },
    ],
  },
  {
    heading: 'I/O',
    items: [
      { type: 'claude', name: 'Claude', glyph: '⟳', description: 'spawn claude --print' },
      { type: 'condition', name: 'Condition', glyph: '◷', description: 'evaluate a condition' },
    ],
  },
];

function handleDragStart(
  e: React.DragEvent<HTMLButtonElement>,
  type: NodeType,
): void {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ type }));
  e.dataTransfer.effectAllowed = 'copy';
}

export default function Palette() {
  return (
    <aside aria-label="palette" className="palette">
      <style>{paletteCss}</style>
      {CATEGORIES.map((category) => (
        <section key={category.heading} className="palette-section">
          <h3 className="section-eyebrow">{category.heading}</h3>
          <ul className="palette-list">
            {category.items.map((item) => (
              <li key={item.type}>
                <button
                  type="button"
                  className="palette-item"
                  draggable
                  aria-label={`add ${item.type} node`}
                  onDragStart={(e) => handleDragStart(e, item.type)}
                >
                  <span className="palette-icon" aria-hidden="true">
                    {item.glyph}
                  </span>
                  <span className="palette-text">
                    <span className="palette-name">{item.name}</span>
                    <span className="palette-desc">{item.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}

const paletteCss = `
.palette {
  border-right: 1px solid var(--border);
  padding: 28px 20px 80px;
  height: calc(100vh - var(--top-bar-h));
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.palette-section {
  display: flex;
  flex-direction: column;
}
.palette-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.palette-item {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  display: grid;
  grid-template-columns: 22px 1fr;
  gap: 12px;
  align-items: center;
  background: transparent;
  border: 1px solid transparent;
  padding: 10px 12px;
  color: var(--fg-soft);
  font-family: var(--mono);
  cursor: grab;
  text-align: left;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.palette-item:hover {
  background: rgba(255, 239, 200, 0.03);
  border-color: var(--border);
  color: var(--fg);
}
.palette-item:active {
  cursor: grabbing;
}
.palette-item:focus-visible {
  outline: 1px solid var(--accent-live);
  outline-offset: -2px;
}
.palette-icon {
  font-family: var(--serif);
  font-size: 18px;
  line-height: 1;
  color: var(--fg-dim);
  text-align: center;
}
.palette-item:hover .palette-icon {
  color: var(--accent-live);
}
.palette-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.palette-name {
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: inherit;
}
.palette-desc {
  font-family: var(--serif);
  font-style: italic;
  font-size: 11px;
  color: var(--fg-muted);
  letter-spacing: 0;
  text-transform: none;
}
`;
