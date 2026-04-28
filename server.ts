import { createServer } from 'http';
import next from 'next';
import { WebSocketServer, type WebSocket } from 'ws';
import { eventBus } from './lib/server/event-bus';
import { workflowEngine } from './lib/server/workflow-engine';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => {
  void handle(req, res);
});

// noServer + manual upgrade routing avoids ws's auto-handler, which on Bun can
// throw a `TypeError: undefined is not an object (evaluating 'message')` from
// inside abortHandshake when the upgrade callback errors. We control the path
// match here and wrap the handoff in try/catch so the process can't be
// crashed by a malformed upgrade.
const wss = new WebSocketServer({ noServer: true });

function isWsPath(url: string | undefined): boolean {
  if (!url) return false;
  return url === '/ws' || url.startsWith('/ws?') || url.startsWith('/ws#');
}

httpServer.on('upgrade', (req, socket, head) => {
  try {
    if (!isWsPath(req.url)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } catch (err) {
    console.warn('[ws] upgrade failed:', err);
    try {
      socket.destroy();
    } catch {
      // socket may already be closed; nothing to do
    }
  }
});

wss.on('error', (err) => {
  console.warn('[ws] server error:', err);
});

wss.on('connection', (ws: WebSocket) => {
  ws.on('error', (err) => {
    console.warn('[ws] client error:', err);
  });
  try {
    ws.send(
      JSON.stringify({ type: 'state_snapshot', state: workflowEngine.getState() }),
    );
  } catch (err) {
    console.warn('[ws] initial send failed:', err);
  }
});

eventBus.subscribe((event) => {
  const msg = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState !== client.OPEN) continue;
    try {
      client.send(msg);
    } catch (err) {
      console.warn('[ws] broadcast send failed:', err);
    }
  }
});

httpServer.listen(port, () => {
  console.log(`InfLoop ready on http://localhost:${port}`);
});
