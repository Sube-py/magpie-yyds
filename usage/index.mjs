// The page's host: magpie loads this as an OpenCode v1 plugin (no provider, no
// hooks) only to start the service the page navigates to.
//
// A magpie page runs in a frame with `connect-src 'none'`: it can't fetch, so
// the numbers are served by this local service instead (127.0.0.1 only), and the
// page's own frame is navigated to it (page/boot.js).

import { startServer } from "./lib/server.mjs"

let started = null

function start(options) {
  if (!started) {
    const port = Number(options?.port)
    started = startServer({ port: Number.isFinite(port) && port > 0 ? port : 3491 })
      .then((info) => {
        console.log(`[magpie-yyds-usage] listening on http://127.0.0.1:${info.port}`)
        return info
      })
      .catch((error) => {
        console.error("[magpie-yyds-usage] could not start:", error?.message ?? error)
        return null
      })
  }
  return started
}

export default {
  id: "magpie-yyds-usage",
  server: async (input, options) => {
    await start(options)
    return {}
  },
}
