import { test } from "node:test";
import assert from "node:assert/strict";
import { proxyHeaders } from "./web-network.mjs";
test("LAN same-origin requests use the private proxy token, overwriting spoofed headers", () => {
  const headers = proxyHeaders(
    {
      headers: {
        host: "192.168.1.50:3000",
        origin: "http://192.168.1.50:3000",
        "x-vani-proxy-token": "spoof",
      },
    },
    8080,
    "private",
  );
  assert.equal(headers.host, "127.0.0.1:8080");
  assert.equal(headers["x-vani-proxy-token"], "private");
});
test("cross-origin and cross-site requests are rejected", () => {
  for (const headers of [
    { host: "192.168.1.50:3000", origin: "http://evil.example" },
    { host: "localhost:3000", "sec-fetch-site": "cross-site" },
  ])
    assert.throws(() => proxyHeaders({ headers }, 8080, "private"));
});
test("standalone proxy strips untrusted tokens", () => {
  assert.equal(
    proxyHeaders(
      { headers: { host: "localhost:3000", "x-vani-proxy-token": "spoof" } },
      8080,
      undefined,
    )["x-vani-proxy-token"],
    undefined,
  );
});
