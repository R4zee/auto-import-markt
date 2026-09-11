import { buildApp, startBackgroundSync } from './app.js';
import { config } from './config.js';

const app = await buildApp();
await startBackgroundSync(app);
await app.listen({ port: config.port, host: config.host });
