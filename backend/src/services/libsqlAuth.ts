import { createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

/**
 * Zugangsschlüssel für einen eigenen libsql-Server (sqld, Teil M): Ed25519-Schlüsselpaar und ein EdDSA-JWT, das
 * @libsql/client als authToken schickt. Der Server prüft mit dem öffentlichen Schlüssel (SQLD_AUTH_JWT_KEY, roh als
 * Base64-URL oder als PEM). Kein Paket nötig – Node-crypto reicht.
 */
export interface LibsqlKeys {
  /** öffentlicher Schlüssel als PEM (SPKI) */
  publicPem: string;
  /** derselbe Schlüssel roh (32 Byte) als Base64-URL – Form für SQLD_AUTH_JWT_KEY */
  publicRaw: string;
  /** privater Schlüssel als PEM (PKCS#8) – nur zum Ausstellen weiterer Tokens aufheben */
  privatePem: string;
}

const b64url = (data: Buffer | string): string => Buffer.from(data).toString('base64url');

export function makeKeys(): LibsqlKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    publicRaw: jwk.x,
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  };
}

/** JWT (EdDSA) mit Ablauf in `days` Tagen; ohne einschränkende Claims = voller Zugriff */
export function makeToken(privatePem: string | KeyObject, days = 3650, claims: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now, exp: now + days * 86400, ...claims }));
  const signature = sign(null, Buffer.from(`${header}.${payload}`), privatePem);
  return `${header}.${payload}.${b64url(signature)}`;
}

/** Prüfung wie der Server: Signatur gegen den öffentlichen Schlüssel, Ablauf */
export function verifyToken(token: string, publicPem: string): { valid: boolean; payload: Record<string, unknown> | null } {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return { valid: false, payload: null };
  const ok = verify(null, Buffer.from(`${h}.${p}`), createPublicKey(publicPem), Buffer.from(s, 'base64url'));
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  return { valid: ok && exp > Date.now() / 1000, payload };
}
