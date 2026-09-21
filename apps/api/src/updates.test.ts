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
it("allows verified LAN proxy updates but rejects forged proxy tokens", () => {
  const previous = process.env.VANI_WEB_PROXY_TOKEN;
  process.env.VANI_WEB_PROXY_TOKEN = "private-test-token";
  const request = {
    ip: "127.0.0.1",
    headers: {
      host: "127.0.0.1:8080",
      origin: "http://192.168.1.50:3000",
      "x-vani-update": "1",
      "x-vani-proxy-token": "private-test-token",
    },
  };
  try {
    expect(() => updateGuard(request)).not.toThrow();
    expect(() =>
      updateGuard({
        ...request,
        headers: { ...request.headers, "x-vani-proxy-token": "forged" },
      }),
    ).toThrow();
    expect(() => updateGuard({ ...request, ip: "192.168.1.50" })).toThrow();
  } finally {
    if (previous === undefined) delete process.env.VANI_WEB_PROXY_TOKEN;
    else process.env.VANI_WEB_PROXY_TOKEN = previous;
  }
});
