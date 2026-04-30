import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ThemeToggle from './ThemeToggle';

// Bun's runtime ships a partial localStorage shim that lacks removeItem; jsdom
// alone is enough for this component, so we install a minimal in-memory mock
// per test and restore the original descriptor in afterEach so the override
// can't leak across files if test ordering changes.
function makeFakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
}

let originalStorageDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  originalStorageDescriptor = Object.getOwnPropertyDescriptor(
    window,
    'localStorage',
  );
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: makeFakeStorage(),
  });
  // Simulate the pre-paint script having set dark.
  document.documentElement.dataset.theme = 'dark';
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
  if (originalStorageDescriptor) {
    Object.defineProperty(window, 'localStorage', originalStorageDescriptor);
  } else {
    // The descriptor was synthesized by us; remove our property so the
    // global slot is empty for the next test file.
    delete (window as unknown as { localStorage?: Storage }).localStorage;
  }
});

describe('<ThemeToggle />', () => {
  it('reflects the current dataset.theme on mount', async () => {
    document.documentElement.dataset.theme = 'light';
    render(<ThemeToggle />);
    // Initial render uses 'dark'; effect syncs to 'light' on mount.
    const btn = await screen.findByRole('button', { name: /switch to dark theme/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles dark → light, updates dataset.theme + localStorage', () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole('button', { name: /switch to light theme/i });
    expect(document.documentElement.dataset.theme).toBe('dark');

    act(() => {
      fireEvent.click(btn);
    });

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('infloop:theme')).toBe('light');
    expect(
      screen.getByRole('button', { name: /switch to dark theme/i }),
    ).toBeInTheDocument();
  });

  it('toggles light → dark on a second click', () => {
    document.documentElement.dataset.theme = 'light';
    render(<ThemeToggle />);
    const btn = screen.getByRole('button', { name: /switch to dark theme/i });

    act(() => {
      fireEvent.click(btn);
    });

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('infloop:theme')).toBe('dark');
  });
});
