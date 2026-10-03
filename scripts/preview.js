// Local UI fixture only. This script is excluded from the extension ZIP.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:8765");
  const pathname = url.pathname === "/" ? "/popup.html" : url.pathname;
  if (!["/popup.html", "/src/popup.js", "/src/popup.css", "/src/usage.js", "/preview-fixture.js"].includes(pathname)) {
    response.writeHead(404).end(); return;
  }
  if (pathname === "/preview-fixture.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(`const params = new URLSearchParams(location.search);
      window.chrome = {runtime: {sendMessage: async () => params.has('error')
        ? {ok: false, code: params.get('error')}
        : {ok: true, usage: {remainingPercent: Number(params.get('percent') ?? 79),
            resetAt: Date.now() + 181800000, fetchedAt: Date.now()}}}};`);
    return;
  }
  let body = await readFile(new URL(pathname.slice(1), root), "utf8");
  if (pathname === "/popup.html") body = body.replace('<script type="module"', '<script src="/preview-fixture.js"></script><script type="module"');
  response.setHeader("Content-Type", pathname.endsWith(".css") ? "text/css" : pathname.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8");
  response.end(body);
}).listen(8765, "127.0.0.1", () => console.log("UI fixture: http://127.0.0.1:8765"));
