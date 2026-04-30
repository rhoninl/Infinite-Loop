import { createServer } from 'http';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3000);

// In dev, opt into Turbopack — webpack compiles every route on first hit and
// re-bundles on edits, which on this app stalls for tens of seconds. Turbopack
// (Rust, incremental) cuts that to a couple of seconds. Build still uses
// webpack since `next build --turbopack` is beta; flip when you're ready.
const app = next({ dev, turbopack: dev });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => {
  void handle(req, res);
});

httpServer.listen(port, () => {
  console.log(`InfLoop ready on http://localhost:${port}`);
});
