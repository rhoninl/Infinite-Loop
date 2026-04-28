import { createServer } from 'http';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => {
  void handle(req, res);
});

httpServer.listen(port, () => {
  console.log(`InfLoop ready on http://localhost:${port}`);
});
