'use client';

import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import type { NodeType } from '@/lib/shared/workflow';
import type { ProviderInfo } from '@/lib/server/providers/types';
import ProviderIcon from './icons/ProviderIcon';

const DRAG_MIME = 'application/x-infloop-node';

interface DragPayload {
  type: NodeType;
  /** Required when `type === 'agent'`; selects the provider for the new node. */
  providerId?: string;
}

interface PaletteItem {
  type: NodeType;
  name: string;
  glyph: string;
  description: string;
  providerId?: string;
}

interface PaletteCategory {
  heading: string;
  items: PaletteItem[];
}

const STATIC_CATEGORIES: PaletteCategory[] = [
  {
    heading: 'Control',
    items: [
      { type: 'start', name: 'Start', glyph: '◇', description: 'begin a workflow' },
      { type: 'end', name: 'End', glyph: '◆', description: 'settle the run' },
      { type: 'loop', name: 'Loop', glyph: '↻', description: 'repeat until met' },
      { type: 'branch', name: 'If', glyph: '⋔', description: 'if/else on a value' },
      { type: 'condition', name: 'Condition', glyph: '◷', description: 'evaluate a condition' },
    ],
  },
];

function modelRunnerCategory(providers: ProviderInfo[]): PaletteCategory {
  return {
    heading: 'Model Runners',
    items: providers.map((p) => ({
      type: 'agent' as const,
      name: p.label,
      glyph: p.glyph ?? '⟳',
      description: p.description,
      providerId: p.id,
    })),
  };
}

function handleDragStart(
  e: React.DragEvent<HTMLButtonElement>,
  item: PaletteItem,
): void {
  const payload: DragPayload = { type: item.type };
  if (item.providerId) payload.providerId = item.providerId;
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = 'copy';
  if (process.env.NODE_ENV !== 'production') {
    console.debug('[palette] dragstart', payload);
  }
}

export default function Palette() {
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
      .catch((err) => {
        console.warn('[palette] failed to load providers:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories: PaletteCategory[] = [
    ...STATIC_CATEGORIES,
    modelRunnerCategory(providers),
  ];

  return (
    <aside aria-label="palette" className="palette">
      <style>{paletteCss}</style>
      {categories.map((category) => (
        <section key={category.heading} className="palette-section">
          <h3 className="section-eyebrow">{category.heading}</h3>
          <ul className="palette-list">
            {category.items.length === 0 ? (
              <li className="palette-empty serif-italic">
                no providers in /providers
              </li>
            ) : (
              category.items.map((item) => (
                <li key={`${item.type}:${item.providerId ?? ''}:${item.name}`}>
                  <Button
                    type="button"
                    variant="light"
                    radius="none"
                    disableRipple
                    disableAnimation
                    className="palette-item"
                    draggable
                    aria-label={
                      item.providerId
                        ? `add ${item.providerId} agent node`
                        : `add ${item.type} node`
                    }
                    onDragStart={(e) => handleDragStart(e, item)}
                  >
                    <span className="palette-icon" aria-hidden="true">
                      {item.providerId ? (
                        <ProviderIcon
                          providerId={item.providerId}
                          fallbackGlyph={item.glyph}
                        />
                      ) : (
                        item.glyph
                      )}
                    </span>
                    <span className="palette-text">
                      <span className="palette-name">{item.name}</span>
                      <span className="palette-desc">{item.description}</span>
                    </span>
                  </Button>
                </li>
              ))
            )}
          </ul>
        </section>
      ))}
    </aside>
  );
}

const paletteCss = `
.palette {
  border-right: 1px solid var(--border);
  padding: 20px 14px 80px;
  height: calc(100vh - var(--top-bar-h));
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
  background: var(--bg);
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
  gap: 2px;
}
.palette-empty {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--fg-muted);
  padding: 6px 12px;
  letter-spacing: 0.04em;
}
/* Each palette item reads like a shell-prompt row in a manifest:
 * "› icon  NAME  description". HeroUI Button gives us the press/focus
 * plumbing; the className below keeps the bespoke shell-row look (no
 * card chrome, just a left-edge phosphor pip on hover) and overrides
 * HeroUI's default min-width / min-height / centered flex layout. */
.palette-item.palette-item {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  min-width: 0;
  height: auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 12px 22px 1fr;
  gap: 10px;
  align-items: center;
  background: transparent;
  border: 0;
  padding: 6px 10px 6px 6px;
  color: var(--fg-soft);
  font-family: var(--mono);
  cursor: grab;
  text-align: left;
  transition: color 120ms ease, background 120ms ease;
  position: relative;
  border-radius: 0;
}
.palette-item::before {
  content: '·';
  color: var(--fg-faint);
  font-size: 12.5px;
  text-align: center;
  width: 12px;
}
.palette-item:hover {
  color: var(--accent-live);
  background: var(--hover-tint);
  text-shadow: var(--crt-glow);
}
.palette-item:hover::before {
  content: '›';
  color: var(--accent-live);
  text-shadow: var(--crt-glow);
}
.palette-item:active {
  cursor: grabbing;
}
.palette-item:focus-visible {
  outline: 1px dashed var(--accent-live);
  outline-offset: -2px;
}
.palette-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--mono);
  font-size: 17px;
  line-height: 1;
  color: var(--fg-dim);
}
.palette-icon svg {
  display: block;
}
.provider-icon-mask {
  display: inline-block;
  background-color: currentColor;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
.palette-item:hover .palette-icon {
  color: var(--accent-live);
}
.palette-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.palette-name {
  font-family: var(--mono);
  font-size: 13px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: inherit;
}
.palette-desc {
  font-family: var(--mono);
  font-style: normal;
  font-size: 12.5px;
  color: var(--fg-dim);
  letter-spacing: 0.02em;
  text-transform: none;
}
.palette-item:hover .palette-desc {
  color: var(--fg-soft);
}
`;
