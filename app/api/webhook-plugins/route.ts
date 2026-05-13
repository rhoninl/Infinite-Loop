import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import { pluginIndex } from '@/lib/server/webhook-plugins';

export async function GET(req: Request): Promise<Response> {
  const unauth = requireAuth(req);
  if (unauth) return unauth;
  const plugins = await pluginIndex.list();
  return NextResponse.json({ plugins });
}
