// Vite plugin: puts the LAN tournament server into `vite preview` (and `vite dev`).
// No extra process, no extra port, no dependencies – just a few routes on the
// server Vite already runs:
//   GET  /api/lan/hello              → { lan: true }
//   GET  /api/lan/stream?client=ID   → Server-Sent Events, one LanMessage per change
//   POST /api/lan/command            → { client, cmd, ... } (see LanCommand)

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { LanCommand } from '../game/lan/protocol';
import { LanSession } from './lanSession';

type Next = (err?: unknown) => void;

const CLIENT_RE = /^[A-Za-z0-9_-]{8,64}$/;
const HEARTBEAT_MS = 15_000;

export function lanMultiplayer(): Plugin {
  let session: LanSession | null = null;
  const get = () => (session ??= new LanSession());

  const handler = (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const path = url.pathname.replace(/^.*\/api\/lan\//, '');
    if (!url.pathname.includes('/api/lan/')) return next();

    if (req.method === 'GET' && path === 'hello') return json(res, 200, { lan: true });

    if (req.method === 'GET' && path === 'stream') {
      const client = url.searchParams.get('client') ?? '';
      if (!CLIENT_RE.test(client)) return json(res, 400, { ok: false, error: 'badRequest' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 1500\n\n');
      const disconnect = get().connect(client, (msg) => res.write(`data: ${JSON.stringify(msg)}\n\n`));
      const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
      req.on('close', () => {
        clearInterval(beat);
        disconnect();
      });
      return;
    }

    if (req.method === 'POST' && path === 'command') {
      readBody(req)
        .then((body) => {
          const { client, ...command } = body as { client?: string } & LanCommand;
          if (!client || !CLIENT_RE.test(client)) return json(res, 400, { ok: false, error: 'badRequest' });
          json(res, 200, get().handle(client, command as LanCommand));
        })
        .catch(() => json(res, 400, { ok: false, error: 'badRequest' }));
      return;
    }

    json(res, 404, { ok: false, error: 'badRequest' });
  };

  return {
    name: 'holdem-lan-multiplayer',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
      // after Vite has printed its addresses
      server.httpServer?.once('listening', () =>
        setTimeout(() => {
          console.log("\n  ♠ Hold'em im Heimnetz: die „Network“-Adresse oben auf allen Geräten öffnen.");
          console.log('    Wer sie zuerst öffnet, ist Admin des Turniers.\n');
        }, 100),
      );
    },
  };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      data += chunk;
      if (data.length > 64_000) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}
