import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { isWriteBlocked, dbReadOnly } = await import('../src/db.js');

describe('Datenbank: Schreibsperre von Turso erkennen', () => {
  it('erkennt die Turso-Meldung bei erschöpftem Kontingent, sonst nichts', () => {
    assert.ok(isWriteBlocked(new Error('BLOCKED: Operation was blocked: SQL write operations are forbidden (writes are blocked, do you need to upgrade your plan?)')));
    assert.ok(isWriteBlocked('writes are blocked'));
    assert.ok(!isWriteBlocked(new Error('SQLITE_BUSY: database is locked')));
    assert.ok(!isWriteBlocked(new Error('no such table: listings')));
  });
  it('startet ohne Sperre nicht im Nur-Lese-Modus', () => {
    assert.equal(dbReadOnly(), false);
  });
});

describe('remoteFetch: Request-Objekt des hrana-Clients an undici weitergeben', async () => {
  const { remoteFetch } = await import('../src/db.js');
  const { createServer } = await import('node:http');
  it('überträgt Adresse, Methode, Kopfzeilen und Rumpf', async () => {
    const server = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization, body: data }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const req = new Request(`http://127.0.0.1:${port}/v2/pipeline`, { method: 'POST', headers: { authorization: 'Bearer abc', 'content-type': 'application/json' }, body: '{"x":1}' });
      const res = await remoteFetch(req);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { method: 'POST', url: '/v2/pipeline', auth: 'Bearer abc', body: '{"x":1}' });
      const plain = await remoteFetch(`http://127.0.0.1:${port}/health`);
      assert.equal((await plain.json() as { method: string }).method, 'GET');
    } finally {
      server.close();
    }
  });
});
