// The page's own service: magpie's frame has no network, so this serves both
// the page and the JSON it draws, on 127.0.0.1 only.
//
// It reads the account's session from magpie's `plugin-auth.json` (written by
// the provider plugin) and never writes anything: every number here is the
// site's own.

import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { accountName, configDir, sessionToken } from "./config.mjs"
import { SiteUsage, range, summary } from "./site.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, "..", "web")
const HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])
const DAYS = 90

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
}

/** Starts the service; gives back the port it listens on. */
export async function startServer({ port = 3491, dir = configDir(), site = new SiteUsage() } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`)
    if (!hostAllowed(req)) return send(res, 403, { error: "只服务于 magpie 窗口里的页面" })
    // magpie's page frame is sandboxed, so its origin is `null` and its fetch is
    // cross-origin even when the URL looks same-origin: answer it as such
    cors(req, res)
    if (req.method === "OPTIONS") {
      res.writeHead(204)
      return res.end()
    }
    // the page itself carries its numbers: a sandboxed frame's fetch is an
    // opaque-origin request, and one less thing to get wrong
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const data = await readSummary({ dir, site, url })
      return page(res, data)
    }
    if (url.pathname === "/api/summary") return send(res, 200, await readSummary({ dir, site, url }), false)
    return file(res, url.pathname)
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", resolve)
  })
  return { port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) }
}

async function readSummary({ dir, site, url }) {
  const token = sessionToken(dir)
  if (!token) return { error: "还没登录只因API：请在「提供商 → 只因API」里登录一次", user: accountName(dir) }
  const days = Number(url.searchParams.get("days")) || DAYS
  const { from, to } = range(days)
  try {
    const [me, requests] = await Promise.all([site.me(token), site.requests(token, { from, to })])
    return { ...summary({ me, requests, from, to }), user: summary({ me, requests, from, to }).user || accountName(dir) }
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }
}

/**
 * The frame's origin is opaque (`null`), so `*` is what it can be given: the
 * service carries no cookies and reads nothing but the account's own session.
 */
function cors(req, res) {
  res.setHeader("access-control-allow-origin", "*")
  res.setHeader("access-control-allow-methods", "GET, OPTIONS")
  res.setHeader("access-control-allow-headers", "accept, content-type")
  res.setHeader("access-control-max-age", "600")
}

function hostAllowed(req) {
  const host = String(req.headers.host ?? "").toLowerCase()
  const name = host.replace(/:\d+$/, "")
  return HOSTS.has(name) || HOSTS.has(host)
}

function send(res, status, body, cache = false) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": cache ? "max-age=60" : "no-store",
  })
  res.end(JSON.stringify(body))
}

/** index.html with the summary in it, as JSON in a script tag. */
function page(res, data) {
  const html = readFileSync(join(WEB, "index.html"), "utf8")
  const json = JSON.stringify(data).replace(/</g, "\\u003c")
  const body = html.replace(
    "</head>",
    `  <script id="summary" type="application/json">${json}</script>\n</head>`,
  )
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
  res.end(body)
}

function file(res, pathname) {
  const name = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
  if (!/^[a-z0-9._-]+$/i.test(name)) return send(res, 404, { error: "not found" })
  const path = join(WEB, name)
  let body
  try {
    body = readFileSync(path)
  } catch {
    return send(res, 404, { error: "not found" })
  }
  const ext = name.slice(name.lastIndexOf("."))
  res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "no-store" })
  res.end(body)
}
