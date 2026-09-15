import type { FastifyReply } from 'fastify';
import { config } from '../config.js';

/**
 * Öffentliche Lese-Antworten für das Vercel-CDN cachen. Der Bestand ändert sich nur durch den Sync (alle 6 h),
 * deshalb darf das CDN Antworten `API_CACHE_SECONDS` lang ausliefern, ohne die Function aufzurufen – jede
 * wiederholte Suche (gleiche URL) kostet dann weder Function-Zeit noch Turso-Zeilen. `stale-while-revalidate`
 * liefert danach sofort die alte Antwort aus und holt die neue im Hintergrund.
 */
export function publicCache(reply: FastifyReply, seconds = config.apiCacheSeconds): void {
  if (seconds <= 0) return;
  reply.header('Cache-Control', `public, max-age=${Math.min(60, seconds)}, s-maxage=${seconds}, stale-while-revalidate=${seconds * 6}`);
  reply.header('CDN-Cache-Control', `public, s-maxage=${seconds}, stale-while-revalidate=${seconds * 6}`);
}
