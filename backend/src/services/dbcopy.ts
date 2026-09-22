import type { Client, InValue } from '@libsql/client';

/**
 * Schema und Daten einer libsql-/Turso-Datenbank in eine andere kopieren (Teil M in docs/deployment.md: Turso → eigener
 * libsql-Server, wenn das Turso-Schreibkontingent erschöpft ist). Liest nur aus der Quelle (Lesen bleibt bei Turso auch
 * bei Schreibsperre erlaubt), schreibt blockweise ins Ziel; INSERT OR REPLACE macht den Lauf wiederholbar. Tabellen
 * zuerst, Indizes danach (schneller als Einfügen in indizierte Tabellen).
 */
export interface CopyOptions {
  /** Zeilen je Schreibblock (Standard 500 – Inserate sind mit Fotos/Suchtext ~2 KB groß) */
  batch?: number;
  /** nur diese Tabellen */
  only?: string[];
  /** Pause zwischen Blöcken (ms), schont den Ziel-Server */
  pauseMs?: number;
  log?: (line: string) => void;
}

export interface CopyReport {
  tables: Record<string, number>;
  indexes: number;
}

interface MasterRow { type: string; name: string; tbl_name: string; sql: string }

function ifNotExists(sql: string): string {
  return sql
    .replace(/^\s*CREATE TABLE\s+(?!IF NOT EXISTS)/i, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/^\s*CREATE (UNIQUE )?INDEX\s+(?!IF NOT EXISTS)/i, (_m, u: string | undefined) => `CREATE ${u ?? ''}INDEX IF NOT EXISTS `);
}

export async function copyDatabase(src: Client, dst: Client, opts: CopyOptions = {}): Promise<CopyReport> {
  const batch = opts.batch ?? 500;
  const log = opts.log ?? (() => {});
  const master = (await src.execute(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name",
  )).rows as unknown as MasterRow[];
  const tables = master.filter((r) => r.type === 'table' && (!opts.only || opts.only.includes(r.name)));
  const indexes = master.filter((r) => r.type === 'index' && tables.some((t) => t.name === r.tbl_name));
  const report: CopyReport = { tables: {}, indexes: 0 };

  for (const t of tables) {
    await dst.execute(ifNotExists(t.sql));
    const cols = (await src.execute(`PRAGMA table_info("${t.name}")`)).rows.map((r) => String(r.name));
    const colList = cols.map((c) => `"${c}"`).join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    let last = 0;
    let n = 0;
    for (;;) {
      // rowid-Paginierung: stabil, ohne OFFSET-Kosten; INTEGER PRIMARY KEY (sync_runs.id) ist selbst der rowid
      const page = await src.execute({ sql: `SELECT rowid AS __rid, ${colList} FROM "${t.name}" WHERE rowid > ? ORDER BY rowid LIMIT ?`, args: [last, batch] });
      if (!page.rows.length) break;
      await dst.batch(
        page.rows.map((r) => ({ sql: `INSERT OR REPLACE INTO "${t.name}" (${colList}) VALUES (${placeholders})`, args: cols.map((c) => r[c] as InValue) })),
        'write',
      );
      last = Number(page.rows[page.rows.length - 1].__rid);
      n += page.rows.length;
      if (n % (batch * 20) === 0) log(`  … ${t.name}: ${n} Zeilen`);
      if (opts.pauseMs) await new Promise((res) => setTimeout(res, opts.pauseMs));
    }
    report.tables[t.name] = n;
    log(`✔ ${t.name}: ${n} Zeilen`);
  }
  for (const i of indexes) {
    await dst.execute(ifNotExists(i.sql));
    report.indexes++;
  }
  log(`✔ ${report.indexes} Indizes`);
  return report;
}
