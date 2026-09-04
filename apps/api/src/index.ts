import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './cli/migrate.js';
import { Repository } from './repository.js';
import { startDiscoveryWorker } from './collection-discovery.js';

try {
  await migrate();
  const repository = new Repository();
  const app = await buildApp(repository);
  await app.listen({ host: config.host, port: config.port });
  const stop = startDiscoveryWorker(repository,error=>app.log.error(error));
  app.addHook('onClose',async()=>{stop();});
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
