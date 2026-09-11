import { buildApp, startBackgroundSync } from './app.ts';
import { config } from './config.ts';

const app = await buildApp();
await startBackgroundSync(app);
await app.listen({ port: config.port, host: config.host });
