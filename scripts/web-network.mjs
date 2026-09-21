export function proxyHeaders(req, apiPort, token) {
  const origin = req.headers.origin;
  if (
    req.headers["sec-fetch-site"] === "cross-site" ||
    (origin && origin !== `http://${req.headers.host}`)
  ) {
    throw new Error("Cross-origin API requests are not allowed.");
  }
  const headers = { ...req.headers, host: `127.0.0.1:${apiPort}` };
  delete headers["x-vani-proxy-token"];
  if (token) headers["x-vani-proxy-token"] = token;
  return headers;
}
