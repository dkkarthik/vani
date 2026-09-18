import { it, expect } from "vitest";
import { updateGuard } from "./updates.js";
it("allows the local UI update request", () => {
  expect(() =>
    updateGuard({
      ip: "127.0.0.1",
      headers: {
        host: "127.0.0.1:8080",
        origin: "http://localhost:3000",
        "x-vani-update": "1",
      },
    }),
  ).not.toThrow();
});
it.each([
  { ip: "192.0.2.1", headers: { host: "localhost", "x-vani-update": "1" } },
  {
    ip: "127.0.0.1",
    headers: { host: "attacker.example", "x-vani-update": "1" },
  },
  {
    ip: "127.0.0.1",
    headers: {
      host: "localhost",
      origin: "https://attacker.example",
      "x-vani-update": "1",
    },
  },
  { ip: "127.0.0.1", headers: { host: "localhost" } },
])("rejects nonlocal/cross-site update requests %j", (request) => {
  expect(() => updateGuard(request)).toThrow();
});
