import { makeKeys, makeToken } from '../services/libsqlAuth.js';

/**
 * Schlüssel und Zugangstoken für den eigenen libsql-Server erzeugen (Teil M):
 *   npm run libsql:token            → neues Schlüsselpaar + Token (10 Jahre)
 *   LIBSQL_PRIVATE_KEY_PEM=… npm run libsql:token → weiteres Token zu einem vorhandenen Schlüssel
 */
const existing = process.env.LIBSQL_PRIVATE_KEY_PEM?.replace(/\\n/g, '\n');
const keys = existing ? null : makeKeys();
const privatePem = existing ?? keys!.privatePem;
const token = makeToken(privatePem, Number(process.env.LIBSQL_TOKEN_DAYS ?? 3650));

if (keys) {
  console.log('# Server (Fly: fly secrets set …, Docker: .env) – öffentlicher Schlüssel roh als Base64-URL:');
  console.log(`SQLD_AUTH_JWT_KEY=${keys.publicRaw}\n`);
  console.log('# Derselbe öffentliche Schlüssel als PEM (Alternative: Datei + SQLD_AUTH_JWT_KEY_FILE):');
  console.log(keys.publicPem);
  console.log('# Privater Schlüssel – sicher aufheben (nur nötig, um später weitere Tokens auszustellen):');
  console.log(keys.privatePem);
}
console.log('# Client (Vercel + GitHub Secrets): TURSO_AUTH_TOKEN =');
console.log(token);
