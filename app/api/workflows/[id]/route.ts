import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    { error: 'GET /api/workflows/[id]: not yet implemented (Phase B unit 6)' },
    { status: 501 },
  );
}

export async function PUT() {
  return NextResponse.json(
    { error: 'PUT /api/workflows/[id]: not yet implemented (Phase B unit 6)' },
    { status: 501 },
  );
}

export async function DELETE() {
  return NextResponse.json(
    { error: 'DELETE /api/workflows/[id]: not yet implemented (Phase B unit 6)' },
    { status: 501 },
  );
}
