import { createServer } from 'http';
import { networkInterfaces } from 'node:os';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3000);
// Bind to all interfaces by default so the console is reachable from other
// machines on the LAN. Override with HOST=127.0.0.1 to keep it loopback-only.
// Heads-up: `/api/run` will execute provider CLIs and (for `command`-kind
// conditions) shell out, so only do this on a trusted network.
const host = process.env.HOST ?? '0.0.0.0';

const app = next({ dev, turbopack: dev });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => {
  void handle(req, res);
});

httpServer.listen(port, host, () => {
  console.log(`InfLoop ready on http://${host}:${port}`);
  if (host === '0.0.0.0') {
    for (const url of lanUrls(port)) console.log(`  also: ${url}`);
  }
});

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
