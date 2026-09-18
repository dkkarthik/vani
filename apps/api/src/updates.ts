import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
const execute = promisify(execFile);
const localHost = (host: string) => {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(`http://${host}`).hostname,
    );
  } catch {
    return false;
  }
};
export function updateGuard(request: Pick<FastifyRequest, "ip" | "headers">) {
  if (
    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip) ||
    !localHost(request.headers.host ?? "") ||
    request.headers["x-vani-update"] !== "1"
  )
    throw Object.assign(
      new Error("Updates must be requested from the local VANI UI."),
      { statusCode: 403 },
    );
  if (request.headers.origin) {
    let allowed = false;
    try {
      const url = new URL(request.headers.origin);
      allowed =
        ["http:", "https:"].includes(url.protocol) && localHost(url.host);
    } catch {
      /* denied */
    }
    if (!allowed)
      throw Object.assign(
        new Error("Update requests must have a local origin."),
        { statusCode: 403 },
      );
  }
}
export async function updater(action: string, extra: string[] = []) {
  const root = process.env.VANI_INSTALL_ROOT;
  const python = process.env.VANI_UPDATE_PYTHON;
  if (!root || !python) {
    if (action === "status" || action === "check")
      return {
        supported: false,
        available: false,
        job: {},
        reason:
          "UI updates are available in managed Ubuntu installations. Update this checkout with Git.",
      };
    throw Object.assign(
      new Error("This installation does not support UI updates."),
      { statusCode: 409 },
    );
  }
  try {
    const result = await execute(
      python,
      [
        join(root, "app/scripts/setup/update.py"),
        action,
        "--root",
        root,
        ...extra,
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    return JSON.parse(result.stdout);
  } catch (error: any) {
    throw Object.assign(
      new Error(
        error.stderr?.trim() ||
          "Update helper failed. Inspect logs/update.log.",
      ),
      { statusCode: 409 },
    );
  }
}
export async function registerUpdates(app: FastifyInstance) {
  app.get("/api/v1/system/updates", async () => updater("check"));
  app.post("/api/v1/system/updates/check", async (request) => {
    updateGuard(request);
    return updater("check", ["--force"]);
  });
  app.post("/api/v1/system/updates/install", async (request, reply) => {
    updateGuard(request);
    const { commit } = z
      .object({ commit: z.string().regex(/^[0-9a-f]{40}$/) })
      .strict()
      .parse(request.body);
    return reply.code(202).send(await updater("start", ["--commit", commit]));
  });
}
