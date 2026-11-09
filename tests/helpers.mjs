// A `fetch` that answers from a table, so the site never has to be asked.

export function makeFetch(handler) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const href = String(url)
    calls.push({ url: href, init, method: init.method ?? "GET", body: parseBody(init.body) })
    const answer = await handler(href, init)
    if (answer instanceof Response) return answer
    const body = typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body ?? null)
    return new Response(body, {
      status: answer.status ?? 200,
      headers: { "content-type": answer.contentType ?? "application/json" },
    })
  }
  return { fetchImpl, calls }
}

function parseBody(body) {
  if (typeof body !== "string") return body
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

/** The site's success envelope. */
export function ok(data) {
  return { body: { code: 0, message: "success", data } }
}

/** The site's refusal. */
export function bad(status, message, extra = {}) {
  return { status, body: { code: status, message, ...extra } }
}

/** A JWT good for `seconds`, as the site's `auth_token` is read. */
export function token(seconds = 3600, claims = {}) {
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({ user_id: 822, email: "sube@example.com", exp: Math.floor(Date.now() / 1000) + seconds, ...claims }),
  ).toString("base64url")
  return `${head}.${payload}.signature`
}
