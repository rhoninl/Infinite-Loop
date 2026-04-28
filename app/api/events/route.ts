import { eventBus } from '@/lib/server/event-bus';
import { workflowEngine } from '@/lib/server/workflow-engine';
import type { WorkflowEvent } from '@/lib/shared/workflow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEEPALIVE_MS = 25_000;

function sseFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(req: Request): Promise<Response> {
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let abortListener: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      // Initial snapshot so the client has the engine state before any events.
      send(sseFrame({ type: 'state_snapshot', state: workflowEngine.getState() }));

      unsubscribe = eventBus.subscribe((event: WorkflowEvent) => {
        send(sseFrame(event));
      });

      keepalive = setInterval(() => send(': keep-alive\n\n'), KEEPALIVE_MS);

      abortListener = () => cleanup();
      req.signal.addEventListener('abort', abortListener);
    },
    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (keepalive) {
      clearInterval(keepalive);
      keepalive = null;
    }
    if (abortListener) {
      try {
        req.signal.removeEventListener('abort', abortListener);
      } catch {
        // request may already be torn down
      }
      abortListener = null;
    }
  }

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
