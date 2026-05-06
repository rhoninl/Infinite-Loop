'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Listbox, ListboxItem, ListboxSection } from '@heroui/react';
import type { NodeType } from '@/lib/shared/workflow';
import type { ProviderInfo } from '@/lib/server/providers/types';

export interface ContextMenuItem {
  type: NodeType;
  label: string;
  /** Required when `type === 'agent'` — selects the provider for the new node. */
  providerId?: string;
}

export interface ContextMenuOpenAt {
  /** Viewport-relative coordinates (clientX/clientY) — used for menu placement. */
  clientX: number;
  clientY: number;
  /** Flow-graph coordinates — used as the new node's position. */
  flowX: number;
  flowY: number;
}

interface Props {
  open: ContextMenuOpenAt | null;
  onClose: () => void;
  onPick: (item: ContextMenuItem, at: ContextMenuOpenAt) => void;
}

const STATIC_GROUPS: Array<{ heading: string; items: ContextMenuItem[] }> = [
  {
    heading: 'Control',
    items: [
      { type: 'start', label: 'Start' },
      { type: 'end', label: 'End' },
      { type: 'loop', label: 'Loop' },
      { type: 'branch', label: 'If' },
      { type: 'condition', label: 'Condition' },
    ],
  },
];

/** Stable key encoding so we can recover the picked item from a Listbox key. */
function itemKey(item: ContextMenuItem): string {
  return `${item.type}:${item.providerId ?? item.type}`;
}

function itemAriaLabel(item: ContextMenuItem): string {
  return item.providerId
    ? `add ${item.providerId} agent node`
    : `add ${item.type} node`;
}

/**
 * Right-click menu for the canvas. Same node catalog as the Palette but
 * placed at the cursor and skipping the drag gesture. Loop adoption is the
 * caller's job — see Canvas.tsx onContextMenuPick.
 *
 * The outer wrapper handles its own positioning + outside-click/Escape
 * dismissal — there's no HeroUI primitive for "appear at exact mouse
 * position" so we don't reach for Popover. Inside, a HeroUI Listbox renders
 * the sections and routes selection through `onAction`.
 */
export default function CanvasContextMenu({ open, onClose, onPick }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [providersError, setProvidersError] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [clamped, setClamped] = useState<{ top: number; left: number } | null>(null);

  // Fetch the provider list once on mount; the menu reuses it across opens.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/providers')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { providers?: ProviderInfo[] }) => {
        if (!cancelled) {
          if (Array.isArray(data.providers)) setProviders(data.providers);
          setProvidersLoaded(true);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setProvidersError(true);
          setProvidersLoaded(true);
          console.warn('[context-menu] failed to load providers:', err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on click-outside / Escape. Bound only while the menu is open so
  // the rest of the app keeps its keyboard shortcuts.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      // Right-click is handled by the canvas's onContextMenu (it toggles
      // the menu open ⇆ closed). Skip it here so the same right-click
      // doesn't close-then-reopen the menu in two competing handlers.
      if (e.button !== 0) return;
      const root = rootRef.current;
      if (!root) return;
      if (!root.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    // CAPTURE PHASE — xyflow's pane handlers call stopPropagation() on
    // native mousedown, which would prevent a bubble-phase document listener
    // from ever seeing the event. Listening in capture means we run BEFORE
    // xyflow gets the chance to suppress the bubble. Clicks inside the menu
    // are filtered by `root.contains(target)` below, so this is safe.
    document.addEventListener('mousedown', onMouseDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouseDown, true);
    };
  }, [open, onClose]);

  // After mount/open, measure the menu and clamp top/left so it never
  // extends past the right or bottom viewport edge. We can't clamp from the
  // event coordinates alone — the menu height depends on how many providers
  // loaded. useLayoutEffect runs synchronously before paint so the user
  // never sees a flicker where items are off-screen first.
  //
  // NOTE: do NOT include `clamped` in the deps array. The effect both reads
  // and writes it, so depending on it would re-fire the effect on every
  // setClamped and loop until the React commit watchdog trips.
  useLayoutEffect(() => {
    if (!open) {
      setClamped(null);
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const margin = 8;
    let top = open.clientY;
    let left = open.clientX;
    if (left + rect.width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height + margin > window.innerHeight) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    if (top !== open.clientY || left !== open.clientX) {
      setClamped({ top, left });
    } else {
      setClamped(null);
    }
  }, [open, providers.length]);

  // Build the list of groups + a flat key→item map for `onAction` routing.
  // Memoized so the Listbox identity stays stable across re-renders that
  // don't actually change the menu contents.
  const { groups, keyMap } = useMemo(() => {
    const groups = [
      ...STATIC_GROUPS,
      {
        heading: 'Model Runners',
        items: providers.map<ContextMenuItem>((p) => ({
          type: 'agent',
          label: p.label,
          providerId: p.id,
        })),
      },
    ];
    const keyMap = new Map<string, ContextMenuItem>();
    for (const group of groups) {
      for (const item of group.items) keyMap.set(itemKey(item), item);
    }
    return { groups, keyMap };
  }, [providers]);

  if (!open) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    top: clamped?.top ?? open.clientY,
    left: clamped?.left ?? open.clientX,
    zIndex: 50,
  };

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="canvas context menu"
      className="min-w-[200px] rounded-md border border-border-strong bg-bg-elevated font-mono shadow-lg"
      style={style}
      // Stop xyflow + the canvas from receiving the mousedown that originated
      // inside the menu — without this, clicking an item would simultaneously
      // dismiss the canvas selection state.
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Listbox
        aria-label="canvas context menu items"
        variant="flat"
        // `onAction` fires for any item activation (mouse OR keyboard). We
        // route by the encoded key back to the original ContextMenuItem.
        onAction={(key) => {
          const item = keyMap.get(String(key));
          if (!item) return;
          onPick(item, open);
          onClose();
        }}
      >
        {groups.map((group) => {
          const isModelRunners = group.heading === 'Model Runners';
          const placeholder = (() => {
            if (isModelRunners && !providersLoaded) return 'loading…';
            if (group.items.length > 0) return null;
            if (isModelRunners && providersError) return 'failed to load providers';
            return 'none available';
          })();

          // ListboxSection requires real ListboxItem children to register
          // them in the ARIA collection. For loading / empty states we
          // render a non-selectable, plain-text item so the section still
          // shows the heading + status without breaking the collection
          // contract.
          if (placeholder) {
            return (
              <ListboxSection key={group.heading} title={group.heading}>
                <ListboxItem
                  key={`${group.heading}__placeholder`}
                  isReadOnly
                  className="serif-italic text-fg-muted"
                  textValue={placeholder}
                >
                  {placeholder}
                </ListboxItem>
              </ListboxSection>
            );
          }

          return (
            <ListboxSection key={group.heading} title={group.heading}>
              {group.items.map((item) => (
                <ListboxItem
                  key={itemKey(item)}
                  aria-label={itemAriaLabel(item)}
                  textValue={item.label}
                >
                  {item.label}
                </ListboxItem>
              ))}
            </ListboxSection>
          );
        })}
      </Listbox>
    </div>
  );
}
