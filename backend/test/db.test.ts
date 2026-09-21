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
