import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer?: {
      register: (route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
      }) => () => void;
    };
  }
}

export const name = 'dsh-better-display';
export const inject = ['webServer'];

/** POST body cap: the reveal body is one small JSON object ({path}). */
const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(value));
}

/**
 * Trust fence, same shape as dsh-skills-manager / dsh-update-checker:
 * the Host must be loopback, cross-site browser requests are refused, and a
 * present Origin must match the Host. Without this, any web page the user
 * visits can POST straight to the route (a text/plain body needs no preflight)
 * and make the host spawn `open`/`explorer`/`xdg-open` on an attacker-chosen
 * path — on Linux `xdg-open <file>` dispatches to the default application
 * handler, which is an execution surface, not just "reveal in file manager".
 */
export function isTrustedRevealRequest(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (typeof host !== 'string' || host === '') return false;
  let hostUrl: URL;
  try { hostUrl = new URL(`http://${host}`); } catch { return false; }
  if (hostUrl.username !== '' || hostUrl.password !== '' || hostUrl.pathname !== '/'
    || hostUrl.search !== '' || hostUrl.hash !== '') return false;
  const hostname = hostUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (!loopback) return false;
  if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originUrl: URL;
    try { originUrl = new URL(origin); } catch { return false; }
    if (originUrl.host !== hostUrl.host) return false;
  }
  return true;
}

/** Test seam: replaced by the test suite so tests never launch a file manager. */
let revealSpawn: (targetPath: string) => void = (targetPath) => {
  if (process.platform === 'darwin') {
    // Exact file reveal in macOS Finder with selection highlight
    spawn('open', ['-R', targetPath], { detached: true, stdio: 'ignore' });
  } else if (process.platform === 'win32') {
    // Exact file selection in Windows Explorer
    spawn('explorer.exe', [`/select,${targetPath}`], { detached: true, stdio: 'ignore' });
  } else {
    spawn('xdg-open', [targetPath], { detached: true, stdio: 'ignore' });
  }
};

export function apply(ctx: Context): void {
  console.log('[my-plugins/dsh-better-display] loaded');

  if (ctx.webServer) {
    ctx.effect(() => {
      return ctx.webServer!.register({
        kind: 'exact',
        path: '/better-display/reveal',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end();
            return;
          }
          if (!isTrustedRevealRequest(req)) {
            sendJson(res, 403, { ok: false, error: 'forbidden' });
            return;
          }
          // JSON-only: a browser form or `text/plain` cross-site POST cannot
          // forge a reveal (the plugin's own client always sends application/json).
          const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
          if (contentType !== 'application/json') {
            sendJson(res, 415, { ok: false, error: 'Content-Type must be application/json' });
            return;
          }
          const declared = Number(req.headers['content-length'] ?? '0');
          if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
            sendJson(res, 413, { ok: false, error: 'payload too large' });
            req.destroy();
            return;
          }
          let body = '';
          let size = 0;
          let oversized = false;
          req.on('data', chunk => {
            if (oversized) return;
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
              oversized = true;
              sendJson(res, 413, { ok: false, error: 'payload too large' });
              req.destroy();
              return;
            }
            body += chunk;
          });
          req.on('end', () => {
            if (oversized) return;
            try {
              const data = JSON.parse(body);
              const targetPath = typeof data.path === 'string' ? data.path.trim() : '';
              if (!targetPath) {
                sendJson(res, 400, { ok: false, error: 'Empty path' });
                return;
              }
              // Only reveal paths that exist: the client resolves workspace
              // paths of produced files, so a miss is a stale entry — and an
              // unrestricted miss would turn the endpoint into a filesystem
              // existence oracle.
              try {
                statSync(targetPath);
              } catch {
                sendJson(res, 404, { ok: false, error: 'Path not found' });
                return;
              }
              revealSpawn(targetPath);
              sendJson(res, 200, { ok: true });
            } catch (err) {
              sendJson(res, 400, { ok: false, error: String(err) });
            }
          });
        },
      });
    }, 'dsh-better-display: /api/better-display/reveal route');
  }
}

/** Internal hooks for the test suite; not part of the plugin's public API. */
export const __test = {
  setRevealSpawn(fn: (targetPath: string) => void): void {
    revealSpawn = fn;
  },
  resetRevealSpawn(): void {
    revealSpawn = (targetPath) => {
      if (process.platform === 'darwin') spawn('open', ['-R', targetPath], { detached: true, stdio: 'ignore' });
      else if (process.platform === 'win32') spawn('explorer.exe', [`/select,${targetPath}`], { detached: true, stdio: 'ignore' });
      else spawn('xdg-open', [targetPath], { detached: true, stdio: 'ignore' });
    };
  },
};
