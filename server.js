import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.PORT || "4173", 10);
const CURSOR_API_BASE = "https://api.cursor.com";
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 90 * 1024 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function getCursorApiKey(req) {
  const headerValue = req.headers["x-cursor-api-key"];
  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim();
  }
  return process.env.CURSOR_API_KEY || "";
}

function authHeaderFor(apiKey) {
  return `Basic ${Buffer.from(`${apiKey}:`, "utf8").toString("base64")}`;
}

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function copyResponseHeaders(cursorResponse, res) {
  const headers = {};
  for (const [key, value] of cursorResponse.headers.entries()) {
    const lower = key.toLowerCase();
    if (lower === "content-length" || lower === "content-encoding") {
      continue;
    }
    headers[key] = value;
  }
  return headers;
}

async function proxyCursorRequest(req, res, requestUrl) {
  const apiKey = getCursorApiKey(req);
  if (!apiKey) {
    sendJson(res, 401, {
      error: "missing_cursor_api_key",
      message:
        "Set CURSOR_API_KEY on the server or provide x-cursor-api-key from the web UI.",
    });
    return;
  }

  const targetPath = requestUrl.pathname.replace(/^\/api\/cursor/, "") || "/";
  if (!targetPath.startsWith("/v")) {
    sendJson(res, 400, {
      error: "invalid_cursor_path",
      message: "Only Cursor API paths such as /v1/agents are proxied.",
    });
    return;
  }

  const targetUrl = `${CURSOR_API_BASE}${targetPath}${requestUrl.search}`;
  const body = ["GET", "HEAD"].includes(req.method || "")
    ? undefined
    : await readRequestBody(req);

  const headers = {
    Authorization: authHeaderFor(apiKey),
    Accept: req.headers.accept || "application/json",
  };

  if (body) {
    headers["Content-Type"] = req.headers["content-type"] || "application/json";
  }

  if (req.headers["last-event-id"]) {
    headers["Last-Event-ID"] = req.headers["last-event-id"];
  }

  const cursorResponse = await fetch(targetUrl, {
    method: req.method,
    headers,
    body,
  });

  const responseHeaders = copyResponseHeaders(cursorResponse, res);
  res.writeHead(cursorResponse.status, responseHeaders);

  if (!cursorResponse.body) {
    res.end();
    return;
  }

  Readable.fromWeb(cursorResponse.body).pipe(res);
}

async function serveStaticFile(req, res, requestUrl) {
  const pathname = decodeURIComponent(requestUrl.pathname);
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    throw error;
  }
}

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);

    if (requestUrl.pathname.startsWith("/api/cursor/")) {
      await proxyCursorRequest(req, res, requestUrl);
      return;
    }

    await serveStaticFile(req, res, requestUrl);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendJson(res, statusCode, {
      error: statusCode === 500 ? "internal_server_error" : "request_failed",
      message: error.message || "Unexpected server error",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Cursor Chat Studio is running at http://localhost:${PORT}`);
  if (!process.env.CURSOR_API_KEY) {
    console.log("Tip: set CURSOR_API_KEY or paste it into the web UI.");
  }
});
