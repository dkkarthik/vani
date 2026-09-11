import type { FastifyInstance } from "fastify";
import type { Repository } from "../repository.js";
import { registerNotes } from "./notes.js";
import { registerConnections } from "./connections.js";
import { registerSynthesis } from "./synthesis.js";
import { registerDiscovery } from "./discovery.js";
import { registerLayers } from "./layers.js";
export async function registerKnowledge(
  app: FastifyInstance,
  repository: Repository,
) {
  await registerNotes(app);
  await registerConnections(app);
  await registerSynthesis(app);
  await registerDiscovery(app, repository);
  await registerLayers(app);
}
