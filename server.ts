import { createServer } from 'http';
import { networkInterfaces } from 'node:os';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const startPort = Number(process.env.PORT ?? 3000);
// Bind to all interfaces by default so the console is reachable from other
// machines on the LAN. Override with HOST=127.0.0.1 to keep it loopback-only.
// Heads-up: `/api/run` will execute provider CLIs and (for `command`-kind
// conditions) shell out, so only do this on a trusted network.
const host = process.env.HOST ?? '0.0.0.0';
// If the requested port is taken, walk forward up to this many ports.
const MAX_PORT_FALLBACK = 20;

const app = next({ dev, turbopack: dev });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => {
  void handle(req, res);
});

const port = await listenWithFallback(httpServer, startPort, host, MAX_PORT_FALLBACK);
console.log(`InfLoop ready on http://${host}:${port}`);
if (port !== startPort) {
  console.log(`  (port ${startPort} was in use; fell through to ${port})`);
}
if (host === '0.0.0.0') {
  for (const url of lanUrls(port)) console.log(`  also: ${url}`);
}

/**
 * Try to bind to `start`; on EADDRINUSE, bump the port and retry up to `maxTries` times.
 * Resolves to the port actually bound. Rejects if every port in the range is busy
 * or any other listen error occurs.
 */
function listenWithFallback(
  server: ReturnType<typeof createServer>,
  start: number,
  bindHost: string,
  maxTries: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const tryListen = () => {
      const candidate = start + attempt;
      const onError = (err: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        if (err.code === 'EADDRINUSE' && attempt < maxTries) {
          attempt += 1;
          console.warn(`port ${candidate} in use, trying ${start + attempt}...`);
          tryListen();
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve(candidate);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(candidate, bindHost);
    };

    tryListen();
  });
}

/** Best-effort enumeration of non-loopback IPv4 addresses for log output. */
function lanUrls(p: number): string[] {
  const out: string[] = [];
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const addr of ifaces[name] ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        out.push(`http://${addr.address}:${p}`);
      }
    }
  }
  return out;
}
