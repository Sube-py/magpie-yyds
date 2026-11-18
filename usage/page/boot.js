// The way in: this frame can't fetch (its CSP says `connect-src 'none'`), so
// the only thing it may do is navigate itself to the service — which then
// serves the page and its JSON.
//
// Where: 127.0.0.1:<port> for the desktop window; under `magpie web` the page
// may be open on another computer, so magpie's bridge names a path it forwards
// (`magpie.service`) and that is used when it is there.

(async () => {
  const DEFAULT_PORT = 3491
  let port = DEFAULT_PORT
  let theme = ""
  let tokens = null
  let service = ""

  try {
    const ready = await window.magpie?.ready
    if (ready) {
      if (typeof ready.dark === "boolean") theme = ready.dark ? "dark" : "light"
      if (ready.tokens && typeof ready.tokens === "object") tokens = ready.tokens
    }
  } catch {}
  try {
    const named = window.magpie?.service
    if (typeof named === "string" && named) service = named
  } catch {}
  try {
    const options = await window.magpie?.options?.get?.()
    if (Number.isFinite(Number(options?.port)) && Number(options.port) > 0) port = Number(options.port)
  } catch {}

  const query = new URLSearchParams()
  if (theme) query.set("theme", theme)
  const slim = {}
  for (const [key, value] of Object.entries(tokens ?? {})) {
    const text = String(value ?? "").trim()
    if (text) slim[key] = text
  }
  if (Object.keys(slim).length) {
    try {
      query.set("tokens", btoa(unescape(encodeURIComponent(JSON.stringify(slim)))))
    } catch {}
  }

  const target = service || `http://127.0.0.1:${port}/`
  const url = target + (target.includes("?") ? "&" : "?") + query.toString()

  // WebKit says nothing when the target is unreachable: if this document is
  // still here after five seconds, the jump never happened.
  setTimeout(() => {
    const said = document.getElementById("said")
    if (!said) return
    said.textContent = `本地用量服务没有在运行（127.0.0.1:${port}）`
    if (document.getElementById("retry")) return
    const button = document.createElement("button")
    button.id = "retry"
    button.type = "button"
    button.textContent = "重试"
    button.addEventListener("click", () => location.reload())
    said.parentNode.appendChild(button)
  }, 5000)

  location.replace(url)
})().catch(() => {
  const said = document.getElementById("said")
  if (said) said.textContent = "这个页面没能连上 magpie"
})
