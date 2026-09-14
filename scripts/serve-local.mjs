import process from "node:process";
import { URL } from "node:url";
import console from "node:console";
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve("apps/web/dist");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
http
  .createServer(async (req, res) => {
    if (req.url.startsWith("/api/")) {
      const upstream = http.request(
        {
          host: "127.0.0.1",
          port: Number(process.env.VANI_API_PORT ?? 8080),
          method: req.method,
          path: req.url,
          headers: { ...req.headers, host: "127.0.0.1:8080" },
        },
        (reply) => {
          res.writeHead(reply.statusCode, reply.headers);
          reply.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end("VANI API unavailable");
      });
      req.pipe(upstream);
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    try {
      let file = resolve(
        root,
        "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
      );
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (!(await stat(file).catch(() => null))?.isFile()) {
        if (extname(file)) {
          res.writeHead(404);
          res.end("File not found");
          return;
        }
        file = resolve(root, "index.html");
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(400);
      res.end("Invalid path");
    }
  })
  .listen(Number(process.env.VANI_WEB_PORT ?? 3000), "127.0.0.1", () =>
    console.log(
      "VANI UI: http://127.0.0.1:" + Number(process.env.VANI_WEB_PORT ?? 3000),
    ),
  );
