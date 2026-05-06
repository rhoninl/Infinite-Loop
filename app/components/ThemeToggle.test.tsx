import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Providers } from '@/providers/heroui-provider';
import ThemeToggle from './ThemeToggle';

// Bun's runtime ships a partial localStorage shim that lacks removeItem;
// next-themes calls removeItem internally, so we install a minimal
// in-memory mock per test and restore the original descriptor in afterEach
// so the override can't leak across files if test ordering changes.
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
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
  if (originalStorageDescriptor) {
    Object.defineProperty(window, 'localStorage', originalStorageDescriptor);
  } else {
    delete (window as unknown as { localStorage?: Storage }).localStorage;
  }
});

function renderWithProviders(saved?: 'dark' | 'light') {
  if (saved) window.localStorage.setItem('infloop:theme', saved);
  return render(
    <Providers>
      <ThemeToggle />
    </Providers>,
  );
}

describe('<ThemeToggle />', () => {
  it('reflects the saved theme on mount', async () => {
    renderWithProviders('light');
    // After the mount effect fires, the button reports the *next* theme
    // it would switch to ("dark") and aria-pressed reflects current
    // ("light").
    const btn = await screen.findByRole('button', { name: /switch to dark theme/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('toggles dark → light, updates dataset.theme + localStorage', () => {
    renderWithProviders('dark');
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
    renderWithProviders('light');
    const btn = screen.getByRole('button', { name: /switch to dark theme/i });

    act(() => {
      fireEvent.click(btn);
    });

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('infloop:theme')).toBe('dark');
  });
});
