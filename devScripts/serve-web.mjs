/**
 * Minimal static file server for the web app.
 *
 * Usage:
 *   node scripts/serve-web.mjs
 *
 * Serves the repository root (index.html, styles.css, scripts/*) so the app can
 * be opened without a build step. Used by scripts/screenshot-web.mjs and the
 * `npm run serve:web` script.
 */
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

/**
 * Resolves a request URL to an absolute path, rejecting any path that escapes
 * the served root (directory traversal defense).
 */
function resolveRequestPath(requestUrl) {
  const { pathname } = new URL(requestUrl, `http://${host}:${port}`);
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const resolved = path.resolve(rootDir, relative);

  if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep)) {
    return null;
  }
  return resolved;
}

const server = http.createServer(async (req, res) => {
  try {
    const filePath = resolveRequestPath(req.url);
    if (!filePath) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    const info = await stat(filePath);
    const target = info.isDirectory()
      ? path.join(filePath, "index.html")
      : filePath;

    const type = CONTENT_TYPES[path.extname(target).toLowerCase()] ||
      "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store",
    });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Static web server listening on http://${host}:${port}`);
  console.log(`Serving ${rootDir}`);
});
