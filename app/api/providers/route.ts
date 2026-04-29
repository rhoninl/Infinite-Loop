import { NextResponse } from 'next/server';
import { loadProviders } from '@/lib/server/providers/loader';
import type { ProviderInfo } from '@/lib/server/providers/types';

export async function GET() {
  try {
    const manifests = await loadProviders();
    const providers: ProviderInfo[] = manifests.map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description,
      glyph: m.glyph,
    }));
    return NextResponse.json({ providers });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to load providers' },
      { status: 500 },
    );
  }
}
