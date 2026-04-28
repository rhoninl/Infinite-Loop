import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'POST /api/run/stop: not yet implemented (Phase B unit 7)' },
    { status: 501 },
  );
}
