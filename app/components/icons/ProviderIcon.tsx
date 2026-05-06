'use client';

/**
 * Brand marks for known AI providers. Each registered provider points at a
 * raster file in `public/icons/`; we render an empty span whose background
 * is `currentColor` and whose shape is the file used as a CSS mask. That
 * way the icon tints with theme + hover state just like text would.
 *
 * Trademarks belong to their respective owners; the marks identify which
 * provider a palette item dispatches against.
 */

interface Props {
  providerId?: string;
  fallbackGlyph?: string;
  size?: number;
}

interface IconEntry {
  src: string;
  label: string;
}

export default function ProviderIcon({
  providerId,
  fallbackGlyph,
  size = 16,
}: Props) {
  const entry = providerId ? REGISTRY[providerId] : undefined;
  if (entry) {
    return (
      <span
        role="img"
        aria-label={entry.label}
        className="provider-icon-mask"
        style={{
          width: size,
          height: size,
          WebkitMaskImage: `url(${entry.src})`,
          maskImage: `url(${entry.src})`,
        }}
      />
    );
  }
  return (
    <span className="provider-icon-fallback" style={{ fontSize: size }}>
      {fallbackGlyph ?? '⟳'}
    </span>
  );
}

const REGISTRY: Record<string, IconEntry> = {
  claude: { src: '/icons/claude.png', label: 'Claude' },
  codex: { src: '/icons/codex.png', label: 'OpenAI' },
};
