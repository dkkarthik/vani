import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './cli/migrate.js';

try {
  await migrate();
  const app = await buildApp();
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
