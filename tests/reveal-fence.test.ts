// /better-display/reveal trust fence: the route spawns open/explorer/xdg-open
// with a request-supplied path, so it must be unreachable cross-site, JSON-only,
// size-capped, and must refuse paths that do not exist.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { apply, isTrustedRevealRequest, __test } from '../src/dsh-better-display.js';

class FakeReq extends Readable {
  headers: Record<string, string | undefined>;
  method: string;
  url: string;
  constructor(headers: Record<string, string | undefined>, body = '', method = 'POST') {
    super();
    this.headers = headers;
    this.method = method;
    this.url = '/better-display/reveal';
    if (body) this.push(body);
    this.push(null);
  }
}

function fakeRes() {
  const chunks: Buffer[] = [];
  const headers: Record<string, string | string[]> = {};
  const res = new EventEmitter() as unknown as ServerResponse;
  Object.assign(res, {
    statusCode: 0,
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; },
    getHeaders: () => headers,
    end(chunk?: unknown) {
      if (chunk !== undefined) chunks.push(Buffer.from(String(chunk)));
      (res as EventEmitter).emit('finish');
      return res;
    },
  });
  return {
    res,
    status: () => (res as unknown as { statusCode: number }).statusCode,
    body: () => Buffer.concat(chunks).toString('utf8'),
  };
}

async function call(headers: Record<string, string | undefined>, body: string, method = 'POST') {
  let handler!: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  const ctx = {
    webServer: { register: (route: { handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }) => { handler = route.handler; return () => {}; } },
    effect: (fn: () => unknown) => { fn(); return () => {}; },
  };
  apply(ctx as never);
  const out = fakeRes();
  await handler(new FakeReq(headers, body, method) as unknown as IncomingMessage, out.res);
  // Body draining (data/end) happens on later ticks; wait for the response to finish.
  await new Promise<void>((resolve) => {
    if (out.status() !== 0 && (out.res as unknown as EventEmitter).listenerCount('finish') === 0) resolve();
    else {
      const timer = setTimeout(resolve, 1000);
      (out.res as unknown as EventEmitter).once('finish', () => { clearTimeout(timer); resolve(); });
    }
  });
  return out;
}

let spawned: string[] = [];
beforeEach(() => { spawned = []; __test.setRevealSpawn((p) => { spawned.push(p); }); });
afterEach(() => { __test.resetRevealSpawn(); });

test('isTrustedRevealRequest: loopback + same-origin only', () => {
  assert.equal(isTrustedRevealRequest({ headers: { host: '127.0.0.1:3080' } } as IncomingMessage), true);
  assert.equal(isTrustedRevealRequest({ headers: { host: '127.0.0.2:3080' } } as IncomingMessage), true);
  assert.equal(isTrustedRevealRequest({ headers: { host: 'localhost:3080' } } as IncomingMessage), true);
  assert.equal(isTrustedRevealRequest({ headers: { host: 'evil.example.com' } } as IncomingMessage), false);
  assert.equal(isTrustedRevealRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://evil.example.com' } } as IncomingMessage), false);
  assert.equal(isTrustedRevealRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' } } as IncomingMessage), true);
  assert.equal(isTrustedRevealRequest({ headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' } } as IncomingMessage), false);
  assert.equal(isTrustedRevealRequest({ headers: {} } as IncomingMessage), false);
});

test('reveal: cross-site-style POST is refused before any spawn', async () => {
  const out = await call(
    { host: '127.0.0.1:3080', origin: 'http://evil.example.com', 'content-type': 'text/plain' },
    JSON.stringify({ path: 'C:\\Windows\\win.ini' }),
  );
  assert.equal(out.status(), 403);
  assert.deepEqual(spawned, []);
});

test('reveal: non-JSON content-type refused (simple-request forge path)', async () => {
  const out = await call(
    { host: '127.0.0.1:3080', 'content-type': 'text/plain' },
    JSON.stringify({ path: '.' }),
  );
  assert.equal(out.status(), 415);
  assert.deepEqual(spawned, []);
});

test('reveal: existing path from a trusted same-origin call spawns once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bd-reveal-'));
  try {
    const file = join(dir, 'out.txt');
    writeFileSync(file, 'x');
    const out = await call(
      { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'content-type': 'application/json' },
      JSON.stringify({ path: file }),
    );
    assert.equal(out.status(), 200);
    assert.deepEqual(spawned, [file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reveal: missing path is a 404, not a spawn (no existence oracle for cross-site)', async () => {
  const out = await call(
    { host: '127.0.0.1:3080', 'content-type': 'application/json' },
    JSON.stringify({ path: 'Z:/definitely/not/there/abcd.txt' }),
  );
  assert.equal(out.status(), 404);
  assert.deepEqual(spawned, []);
});

test('reveal: oversized declared body is refused with 413', async () => {
  const out = await call(
    { host: '127.0.0.1:3080', 'content-type': 'application/json', 'content-length': String(10 * 1024 * 1024) },
    '{}',
  );
  assert.equal(out.status(), 413);
  assert.deepEqual(spawned, []);
});
