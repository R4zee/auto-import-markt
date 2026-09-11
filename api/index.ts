import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../backend/src/app.ts';

/**
 * Vercel Serverless Function: alle /api/* Anfragen werden per vercel.json-Rewrite hierher
 * geleitet und an die Fastify-App durchgereicht. Die App wird pro Instanz einmal gebaut.
 */
let appPromise: Promise<FastifyInstance> | null = null;

function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = buildApp({ logger: false }).then(async (app) => {
      await app.ready();
      return app;
    });
    appPromise.catch(() => { appPromise = null; });
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  app.server.emit('request', req, res);
}
