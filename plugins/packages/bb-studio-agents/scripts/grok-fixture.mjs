#!/usr/bin/env node
// Deterministic local xAI API fixture for staged BB: one chat model that
// streams a fixed reply. Key: bb-grok-fixture. Port: GROK_FIXTURE_PORT or 8643.
import { createServer } from 'node:http';
const reply = 'Hello from the Grok fixture. I run outside Studio, so my memory and tools live on xAI.';
const server = createServer(async (req, res) => {
  if (req.headers.authorization !== 'Bearer bb-grok-fixture') { res.writeHead(401); res.end(); return; }
  for await (const _ of req) { /* drain */ }
  if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'grok-fixture' }] })); return; }
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const word of reply.split(/(?<= )/)) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: word } }] })}\n\n`);
    res.end('data: [DONE]\n\n');
    return;
  }
  res.writeHead(404); res.end();
});
const port = Number(process.env.GROK_FIXTURE_PORT || 8643);
server.listen(port, '127.0.0.1', () => console.log(`Grok fixture on http://127.0.0.1:${port}/v1`));
