import { createApp } from './app.js';
import { defaultDataDir } from './config.js';

const port = Number(process.env.PORT) || 8787;
const dataDir = defaultDataDir();
const app = createApp({ dataDir });

const server = app.listen(port, () => {
  console.log(`Latent API listening on http://localhost:${port} (data: ${dataDir})`);
});

const shutdown = () => {
  server.close(() => {
    app.locals.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
