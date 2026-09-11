import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';

/**
 * Vercel Serverless Function: alle /api/* Anfragen werden per vercel.json-Rewrite hierher
 * geleitet und an die Fastify-App durchgereicht. Die App wird pro Instanz einmal gebaut.
 * Startfehler (fehlende Umgebungsvariablen, Bundling) werden als JSON gemeldet statt als
 * FUNCTION_INVOCATION_FAILED.
 */
let appPromise: Promise<FastifyInstance> | null = null;

async function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = (async () => {
      const { buildApp } = await import('../backend/src/app.ts');
      const app = await buildApp({ logger: false });
      await app.ready();
      return app;
    })();
    appPromise.catch(() => { appPromise = null; });
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const app = await getApp();
    app.server.emit('request', req, res);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error('startup failed', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      error: 'startup_failed',
      message: err.message,
      hint: 'Prüfe in Vercel → Settings → Environment Variables: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, ADMIN_KEY, CRON_SECRET; danach Redeploy.',
      stack: process.env.VERCEL_ENV === 'production' ? undefined : err.stack,
    }));
  }
}
