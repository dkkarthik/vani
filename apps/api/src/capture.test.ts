import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { CaptureAccess, registerCaptureRoutes } from "./capture.js";
import { Repository } from "./repository.js";
import { config } from "./config.js";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
it("requires a scoped key and accepts pairing only from the VANI UI", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vani-capture-auth-"));
  directories.push(directory);
  const access = new CaptureAccess(directory);
  const repository = new Repository();
  repository.listCollections = vi.fn().mockResolvedValue([]);
  const app = Fastify();
  await registerCaptureRoutes(app, repository, undefined, access);
  try {
    for (const origin of ["https://untrusted.test", "null", "malformed"]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/capture-key",
            headers: { origin, "x-vani-client": "web" },
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/capture-key",
          headers: { origin: config.webOrigin },
        })
      ).statusCode,
    ).toBe(403);
    const paired = await app.inject({
      method: "POST",
      url: "/api/v1/capture-key",
      headers: { origin: config.webOrigin, "x-vani-client": "web" },
    });
    const token = paired.json().token as string;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(paired.headers["cache-control"]).toBe("no-store");
    expect((await stat(join(directory, "capture-key"))).mode & 0o777).toBe(
      0o600,
    );
    expect(await access.token(true)).toBe(token);
    for (const authorization of [
      "",
      token,
      `Bearer ${"é".repeat(64)}`,
      `Bearer ${"0".repeat(64)}`,
    ]) {
      expect(
        (
          await app.inject({
            url: "/api/v1/capture/collections",
            headers: { authorization },
          })
        ).statusCode,
      ).toBe(401);
    }
    expect(
      (
        await app.inject({
          url: "/api/v1/capture/collections",
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(200);
    await app.inject({
      method: "DELETE",
      url: "/api/v1/capture-key",
      headers: { origin: config.webOrigin, "x-vani-client": "web" },
    });
    expect(
      (
        await app.inject({
          url: "/api/v1/capture/collections",
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    await app.close();
  }
});
