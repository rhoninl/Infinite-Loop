import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    { error: 'GET /api/workflows: not yet implemented (Phase B unit 6)' },
    { status: 501 },
  );
}

export async function POST() {
  return NextResponse.json(
    { error: 'POST /api/workflows: not yet implemented (Phase B unit 6)' },
    { status: 501 },
  );
}
