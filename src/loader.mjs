// What a request goes out with.
//
// The account carries no key of its own: its keys are settings, several of
// them, each in its own group. So the key is chosen per request by the model
// asked for — the first key of the person's list whose group serves it — and
// a model no key serves is turned away here as `model_not_found`, before it is
// sent anywhere.
//
// A key the site refuses (401/403) is passed over for the next key that serves
// the same model, once: a revoked key shouldn't fail a request another key can
// answer.

import { chatBase } from "./constants.mjs"

export function routedLoader({ router, keys }) {
  return async () => ({
    baseURL: chatBase(),
    // the key goes on each request in fetch below, chosen by its model
    apiKey: "",
    fetch: (input, init) => send(input, init, { router, keys }),
  })
}

async function send(input, init, { router, keys }) {
  const body = await bodyOf(input, init)
  const model = modelOf(body)
  const candidates = await router.candidates(keys, model)
  if (!candidates.length) return notServed(model)

  let answer
  for (const [index, candidate] of candidates.entries()) {
    answer = await once(input, init, body, candidate.key)
    if (!refusedKey(answer.status) || index === candidates.length - 1) return answer
    router.forget(candidate.key)
  }
  return answer
}

/** One request with a key on it. */
function once(input, init, body, key) {
  const request = input instanceof Request && init?.body === undefined ? input : null
  const headers = new Headers(init?.headers ?? request?.headers)
  headers.set("Authorization", `Bearer ${key}`)
  headers.delete("content-length")
  headers.delete("x-api-key")
  return fetch(request ? request.url : String(input), {
    ...init,
    method: init?.method ?? request?.method ?? "POST",
    headers,
    ...(body === undefined ? {} : { body }),
  })
}

/** The body as it will be sent: a plugin's fetch is handed a string. */
async function bodyOf(input, init) {
  if (init?.body !== undefined) return init.body
  if (input instanceof Request) return await input.clone().text()
  return undefined
}

function modelOf(body) {
  if (typeof body !== "string") return ""
  try {
    const parsed = JSON.parse(body)
    return typeof parsed?.model === "string" ? parsed.model : ""
  } catch {
    return ""
  }
}

function refusedKey(status) {
  return status === 401 || status === 403
}

/** What magpie reads as "this provider doesn't serve that model". */
function notServed(model) {
  const said = model ? `账号下的密钥均不提供模型 ${model}` : "请求未指定模型"
  return new Response(JSON.stringify({ error: { message: said, type: "model_not_found", code: "model_not_found" } }), {
    status: 404,
    headers: { "content-type": "application/json" },
  })
}
