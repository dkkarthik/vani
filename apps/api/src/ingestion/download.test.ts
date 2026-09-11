import { EventEmitter } from "node:events";
import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ dns: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ resolve4: mocks.dns }));
vi.mock("node:https", () => ({ request: mocks.request }));
vi.mock("node:http", () => ({ request: mocks.request }));
import { downloadPaper } from "./download.js";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.dns.mockResolvedValue(["93.184.216.34"]);
});
function respond(
  status: number,
  headers: Record<string, string>,
  bytes: Buffer,
) {
  mocks.request.mockImplementation((_url, options, callback) => {
    expect(options.family).toBe(4);
    options.lookup("ignored", {}, (error: any, ip: string) => {
      expect(error).toBeNull();
      expect(ip).toBe("93.184.216.34");
    });
    const request: any = new EventEmitter();
    request.destroy = (e: any) => {
      request.emit("error", e);
      request.emit("close");
    };
    request.end = () =>
      queueMicrotask(() => {
        const response: any = new EventEmitter();
        response.statusCode = status;
        response.headers = headers;
        response.resume = () => {};
        callback(response);
        response.emit("data", bytes);
        response.emit("end");
        request.emit("close");
      });
    return request;
  });
}
it("pins the validated DNS address and returns PDF bytes", async () => {
  respond(
    200,
    { "content-type": "application/pdf" },
    Buffer.from("%PDF- fixture"),
  );
  expect(
    (await downloadPaper("https://papers.example/file")).bytes.toString(),
  ).toBe("%PDF- fixture");
});
it("revalidates redirect destinations before connecting", async () => {
  mocks.dns
    .mockResolvedValueOnce(["93.184.216.34"])
    .mockResolvedValue(["127.0.0.1"]);
  respond(302, { location: "http://127.0.0.1/private" }, Buffer.alloc(0));
  await expect(downloadPaper("https://papers.example/file")).rejects.toThrow(
    "public internet",
  );
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("aborts oversized downloads", async () => {
  respond(200, { "content-type": "application/pdf" }, Buffer.alloc(100));
  await expect(
    downloadPaper("https://papers.example/file", 10),
  ).rejects.toThrow("size limit");
});
