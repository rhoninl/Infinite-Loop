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
  /** "mask" tints the image with `currentColor` via a CSS mask — used
   * for monochrome line marks (Claude, Codex) so they read as one of
   * the theme accents. "img" renders the file as a regular <img>, used
   * for marks whose original colors (or shading) the user wants
   * preserved (the Hermes mascot is a detailed black-on-white drawing
   * that loses depth when collapsed to a single tint). */
  mode?: 'mask' | 'img';
}

export default function ProviderIcon({
  providerId,
  fallbackGlyph,
  size = 16,
}: Props) {
  const entry = providerId ? REGISTRY[providerId] : undefined;
  if (entry) {
    if (entry.mode === 'img') {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.src}
          alt={entry.label}
          width={size}
          height={size}
          className="provider-icon-img"
          style={{ width: size, height: size }}
        />
      );
    }
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
  hermes: { src: '/icons/hermes.webp', label: 'Hermes', mode: 'img' },
};
