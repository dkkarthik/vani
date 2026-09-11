import { registerBoards } from '../planning/boards.js';
import { registerInsights } from '../planning/insights.js';
import { registerMonitor } from '../planning/monitor.js';
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
  await registerBoards(app);await registerInsights(app);await registerMonitor(app);
  await registerNotes(app);
  await registerConnections(app);
  await registerSynthesis(app);
  await registerDiscovery(app, repository);
  await registerLayers(app);
}
