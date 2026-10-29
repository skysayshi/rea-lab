import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

function observePost({ request, response, url, workspace, observed, origin }) {
  assert.ok(
    observed.posts.length < 3,
    "Only three declared POST operations are allowed",
  );
  const post = {
    ordinal: observed.posts.length,
    method: request.method,
    path: url.pathname + url.search,
    received_at: new Date().toISOString(),
    origin_matches: request.headers.origin === origin,
    token_matches: request.headers["x-edos-scene-token"] === workspace.token,
    content_type: request.headers["content-type"],
  };
  observed.posts.push(post);
  const chunks = [];
  let size = 0;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > 65536)
      request.destroy(new Error("Synthetic request budget exceeded"));
    else chunks.push(chunk);
  });
  request.once("end", () => {
    post.body_text = Buffer.concat(chunks).toString("utf8");
    try {
      post.body = JSON.parse(post.body_text);
    } catch {
      post.body_parse_error = true;
    }
  });
  const end = response.end.bind(response);
  response.end = (...args) => {
    if (args[0] !== undefined) {
      try {
        post.response_body = JSON.parse(Buffer.from(args[0]).toString("utf8"));
      } catch {
        post.response_body_parse_error = true;
      }
    }
    return end(...args);
  };
  response.once("finish", () => {
    post.status = response.statusCode;
    post.finished_at = new Date().toISOString();
  });
}

async function serveStatic(request, response, url, dist) {
  if (request.method !== "GET") {
    response.writeHead(405);
    response.end();
    return;
  }
  const file = resolve(
    dist,
    "." +
      decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
  );
  const path = relative(dist, file);
  assert.ok(
    path && !path.startsWith("..") && !isAbsolute(path),
    "Static request must stay in the owned bundle",
  );
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    response.writeHead(404);
    response.end();
    return;
  }
  const type = file.endsWith(".js")
    ? "text/javascript"
    : file.endsWith(".css")
      ? "text/css"
      : "text/html";
  response.writeHead(200, {
    "Content-Type": type + "; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
  });
  response.end(bytes);
}

/** One real HTTP owner: original IncomingMessage/ServerResponse reach the handler. */
export async function startMountedServer({
  dist,
  workspace,
  handleSceneRequest,
  observed,
}) {
  assert.ok(isAbsolute(dist));
  let origin;
  const pending = [];
  const server = http.createServer((request, response) => {
    const operation = (async () => {
      const url = new URL(request.url, origin);
      if (url.pathname.startsWith("/api/scene-workspace")) {
        if (request.method === "POST")
          observePost({ request, response, url, workspace, observed, origin });
        assert.equal(
          await handleSceneRequest(workspace, request, response, origin),
          true,
        );
      } else await serveStatic(request, response, url, dist);
    })().catch((error) => {
      observed.server_errors.push({ message: error.message });
      if (!response.headersSent) response.writeHead(500);
      if (!response.writableEnded) response.end();
    });
    pending.push(operation);
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });
  return {
    origin,
    settle: () => Promise.all(pending),
    close: async () => {
      server.closeAllConnections();
      if (server.listening)
        await new Promise((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
    },
  };
}
