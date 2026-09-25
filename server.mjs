/**
 * ScamScope server - static UI plus a single analysis endpoint.
 *
 * POST /analyze  with JSON body {"message": "..."} streams Server-Sent Events
 * while the on-device model generates:
 *   event: status  data: {"phase":"loading","progress":57.3}
 *   event: token   data: {"text":"VERDICT: SCAM"}
 *   event: done    data: {"requestId":"..."}
 *   event: error   data: {"message":"..."}
 *
 * Binds to 127.0.0.1 only. There is no cloud call anywhere in this file -
 * inference happens in-process via shield.mjs and the QVAC SDK.
 */

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureModel, isModelReady, analyzeStream, cancelAnalysis, shutdown } from './shield.mjs';

const requestedPort = Number(process.env.PORT);
const PORT = Number.isInteger(requestedPort) && requestedPort > 1023 ? requestedPort : 8787;
const HOST = '127.0.0.1';
const here = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function sendSSE(res, event, data) {
  res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
}

async function handleAnalyze(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let raw = '';
  for await (const chunk of req) raw += chunk;

  let message = '';
  try {
    ({ message } = JSON.parse(raw));
  } catch {
    /* fallthrough to validation below */
  }
  const trimmed = typeof message === 'string' ? message.trim() : '';
  const tooShort = trimmed.length < 5;
  const tooLong = trimmed.length > 12000;
  if (tooShort || tooLong) {
    sendSSE(res, 'error', { message: 'Provide a "message" field with 5-12000 characters.' });
    return res.end();
  }

  // One-time model download/load, streamed as progress to the UI.
  if (!isModelReady()) {
    sendSSE(res, 'status', { phase: 'loading', progress: 0 });
    try {
      await ensureModel((p) => {
        if (typeof p?.percentage === 'number') {
          sendSSE(res, 'status', { phase: 'loading', progress: Math.min(100, p.percentage) });
        }
      });
    } catch (err) {
      sendSSE(res, 'error', { message: 'Model load failed: ' + (err?.message || String(err)) });
      return res.end();
    }
  }

  sendSSE(res, 'status', { phase: 'analyzing' });

  let run;
  try {
    run = await analyzeStream(trimmed);
  } catch (err) {
    sendSSE(res, 'error', { message: 'Inference failed: ' + (err?.message || String(err)) });
    return res.end();
  }

  // If the browser disconnects mid-analysis, cancel the on-device run.
  let clientGone = false;
  req.on('close', () => {
    clientGone = true;
    cancelAnalysis(run.requestId);
  });

  try {
    for await (const event of run.events) {
      if (clientGone) break;
      if (event.type === 'contentDelta' && event.text) {
        sendSSE(res, 'token', { text: event.text });
      } else if (event.type === 'completionDone' && event.error) {
        sendSSE(res, 'error', { message: event.error.message });
      }
    }
    await run.final;
    if (!clientGone) sendSSE(res, 'done', { requestId: run.requestId });
  } catch (err) {
    if (!clientGone) sendSSE(res, 'error', { message: err?.message || String(err) });
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

  if (req.method === 'POST' && url.pathname === '/analyze') {
    return handleAnalyze(req, res).catch((err) => {
      try {
        sendSSE(res, 'error', { message: err?.message || String(err) });
        res.end();
      } catch {
        /* socket already gone */
      }
    });
  }

  if (req.method === 'GET') {
    const file = url.pathname === '/' ? '/index.html' : url.pathname;
    const full = path.join(here, path.normalize(file));
    if (!full.startsWith(here)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const body = readFileSync(full);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      res.end(body);
      return;
    } catch {
      res.writeHead(404).end('Not found');
      return;
    }
  }

  res.writeHead(405).end('Method not allowed');
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('');
    console.error('  Port ' + PORT + ' is already in use. Start on another port:');
    console.error('    bash/Mac/Linux:  PORT=8890 npm start');
    console.error('    PowerShell:      $env:PORT=8890; npm start');
    console.error('');
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ScamScope running at http://127.0.0.1:' + PORT);
  console.log('  100% on-device inference via QVAC - the first analysis');
  console.log('  downloads the model once; after that it works offline.');
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log('  ' + signal + ' received - unloading model, closing QVAC worker...');
    server.close();
    await shutdown();
    process.exit(0);
  });
}
