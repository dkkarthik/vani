import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MetadataPatch, MetadataField } from "@vani/shared";
import { MetadataRepository } from "./metadata.js";
import type { Repository } from "./repository.js";
export async function registerMetadataRoutes(
  app: FastifyInstance,
  repository: Repository,
) {
  const metadata = new MetadataRepository(repository);
  const id = (params: unknown) =>
    z.object({ id: z.string().uuid() }).parse(params).id;
  const revision = z.number().int().positive();
  app.get("/api/v1/works/:id/metadata", (request) =>
    metadata.get(id(request.params)),
  );
  app.patch("/api/v1/works/:id/metadata", (request) => {
    const input = z
      .object({
        revision,
        patch: MetadataPatch,
        reason: z.string().max(2000).default(""),
      })
      .parse(request.body);
    return metadata.edit(
      id(request.params),
      input.revision,
      input.patch,
      input.reason,
    );
  });
  app.post("/api/v1/works/:id/metadata/lookup", (request) => {
    const input = z
      .object({ revision, identifier: z.string().trim().min(1).max(500) })
      .parse(request.body);
    return metadata.lookup(
      id(request.params),
      input.revision,
      input.identifier,
    );
  });
  app.post("/api/v1/works/:id/metadata/reconcile", (request) => {
    const input = z
      .object({
        revision,
        assertionId: z.string().uuid(),
        fields: z.array(MetadataField).max(30),
        overrideLocks: z.boolean().default(false),
        keepCurrent: z.boolean().default(false),
        reason: z.string().max(2000).default(""),
      })
      .parse(request.body);
    return metadata.reconcile(
      id(request.params),
      input.revision,
      input.assertionId,
      input.fields,
      input.overrideLocks,
      input.keepCurrent,
      input.reason,
    );
  });
}
