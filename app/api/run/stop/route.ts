import { NextResponse } from 'next/server';
import { loopManager } from '@/lib/server/loop-manager';

export async function POST() {
  loopManager.stop();
  return NextResponse.json({ state: loopManager.getState() }, { status: 200 });
}
