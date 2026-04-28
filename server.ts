import { createServer } from 'http';
import next from 'next';
import { WebSocketServer } from 'ws';
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

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (socket) => {
  socket.send(
    JSON.stringify({ type: 'state_snapshot', state: workflowEngine.getState() }),
  );
});

eventBus.subscribe((event) => {
  const msg = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(msg);
    }
  }
});

httpServer.listen(port, () => {
  console.log(`InfLoop ready on http://localhost:${port}`);
});
