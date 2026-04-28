import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'POST /api/run: not yet implemented (Phase B unit 7)' },
    { status: 501 },
  );
}

export async function GET() {
  return NextResponse.json(
    { error: 'GET /api/run: not yet implemented (Phase B unit 7)' },
    { status: 501 },
  );
}
