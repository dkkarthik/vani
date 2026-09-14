import { bindModelPersistence } from "./core/routes.js";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { migrate } from "./cli/migrate.js";
import { Repository } from "./repository.js";
import { startDiscoveryWorker } from "./collection-discovery.js";

try {
  await migrate();
  bindModelPersistence();
  const repository = new Repository();
  const app = await buildApp(repository);
  let stop: () => void = () => {};
  app.addHook("onClose", async () => {
    stop();
  });
  await app.listen({ host: config.host, port: config.port });
  stop =
    process.env.VANI_WORKER_ENABLED === "false"
      ? () => {}
      : startDiscoveryWorker(repository, (error) => app.log.error(error));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
