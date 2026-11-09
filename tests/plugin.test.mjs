// The plugin as magpie loads it: one account for the check-in and the
// balance, its keys as settings, and requests routed to the key whose group
// serves the model — against a stand-in for the site on this machine.

import assert from "node:assert/strict"
import { createServer } from "node:http"
import test, { after, before } from "node:test"

import { YydsAuthPlugin } from "../index.mjs"
import { PROVIDER_ID } from "../src/constants.mjs"

const ACCESS = jwt({ user_id: 822, email: "sube@example.com" })
const REFRESH = "rt-abc123"
const KEY_GPT = `sk-${"a".repeat(24)}`
const KEY_GLM = `sk-${"b".repeat(24)}`

const state = {
  checkedIn: false,
  claimStatus: 200,
  captcha: false,
  balance: 79.190222963,
  groups: { [KEY_GPT]: ["gpt-6.1-sol", "shared"], [KEY_GLM]: ["glm-5.3", "shared"] },
  refused: [],
  used: [],
}

let server
let plugin
let base

before(async () => {
  server = createServer(handle)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${server.address().port}`
  process.env.YYDS_ORIGIN = base
  plugin = await YydsAuthPlugin(
    { client: { auth: { set: async () => {} } } },
    { keys: [{ label: "GPT 稳定分组", key: KEY_GPT }, { label: "Glm", key: KEY_GLM }] },
  )
})

after(() => {
  delete process.env.YYDS_ORIGIN
  server?.close()
})

test("one provider, one account, the site's own base", async () => {
  const config = {}
  await plugin.config(config)
  const provider = config.provider[PROVIDER_ID]
  assert.equal(provider.name, "只因API")
  assert.equal(provider.npm, "@ai-sdk/openai-compatible")
  assert.equal(provider.api, `${base}/v1`)
  assert.deepEqual(provider.models, {}, "models come from the keys, not a fixed list")
})

test("the account signs in two ways, and asks for no key", () => {
  const [password, pasted] = plugin.auth.methods
  assert.equal(plugin.auth.methods.length, 2)
  assert.deepEqual(password.prompts.map((p) => p.key), ["email", "password"])
  assert.deepEqual(pasted.prompts.map((p) => p.key), ["session"])
})

test("the account's models are the union of its keys' groups", async () => {
  const listed = await plugin.provider.models({ models: {} }, { auth: record() })
  assert.deepEqual(Object.keys(listed).sort(), ["glm-5.3", "gpt-6.1-sol", "shared"])
  assert.equal(listed["glm-5.3"].api.url, `${base}/v1`)
  assert.equal(listed["glm-5.3"].providerID, PROVIDER_ID)
})

test("a key nobody configured means no models, and no error", async () => {
  const bare = await YydsAuthPlugin({ client: {} }, {})
  const listed = await bare.provider.models({ models: { kept: {} } }, { auth: record() })
  assert.deepEqual(Object.keys(listed), ["kept"], "the list magpie had stands")
  assert.equal(bare.auth.loader, undefined, "and nothing is routed")
})

test("keys that can't read a single model say why", async () => {
  const stale = await YydsAuthPlugin({ client: {} }, { keys: [{ label: "dead", key: `sk-${"d".repeat(24)}` }] })
  state.refused = [`sk-${"d".repeat(24)}`]
  await assert.rejects(stale.provider.models({ models: {} }), /均未能读取模型/)
  state.refused = []
})

test("a request goes out with the key whose group serves its model", async () => {
  const options = await plugin.auth.loader(async () => record())
  assert.equal(options.baseURL, `${base}/v1`)
  const answer = await options.fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    body: JSON.stringify({ model: "glm-5.3", messages: [] }),
  })
  assert.equal(answer.status, 200)
  assert.deepEqual(await answer.json(), { served: "glm-5.3", key: KEY_GLM })
})

test("a model two keys serve goes to the first of them", async () => {
  const options = await plugin.auth.loader(async () => record())
  const answer = await options.fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    body: JSON.stringify({ model: "shared", messages: [] }),
  })
  assert.equal((await answer.json()).key, KEY_GPT, "the person's order decides")
})

test("a model no key serves is turned away here, not sent", async () => {
  const options = await plugin.auth.loader(async () => record())
  state.used = []
  const answer = await options.fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    body: JSON.stringify({ model: "not-served", messages: [] }),
  })
  assert.equal(answer.status, 404)
  assert.equal((await answer.json()).error.code, "model_not_found")
  assert.deepEqual(state.used, [], "no request left for a model no key serves")
})

test("a key the site refuses is passed over for one that serves the model", async () => {
  const options = await plugin.auth.loader(async () => record())
  state.refused = [KEY_GPT]
  const answer = await options.fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    body: JSON.stringify({ model: "shared", messages: [] }),
  })
  assert.equal(answer.status, 200)
  assert.equal((await answer.json()).key, KEY_GLM)
  state.refused = []
})

test("the account's card reads its wallet", async () => {
  const out = await plugin.auth.usage(async () => record())
  assert.equal(out.user, "sube")
  assert.deepEqual(out.windows, [{ name: "余额", balance: state.balance, unit: "USD", display: "$79.19" }])
})

test("the check-in claims once, then says the day is in", async () => {
  const first = await plugin.auth.checkin(async () => record())
  assert.equal(first.outcome, "claimed")
  assert.equal(first.credit, 0.011)
  const second = await plugin.auth.checkin(async () => record())
  assert.equal(second.outcome, "done")
})

test("a captcha-guarded day is left to the site", async () => {
  state.checkedIn = false
  state.captcha = true
  // a fresh plugin, since the site's captcha settings are read at most once a minute
  const fresh = await YydsAuthPlugin({ client: {} }, { keys: [{ label: "", key: KEY_GPT }] })
  const out = await fresh.auth.checkin(async () => record())
  assert.equal(out.outcome, "captcha")
  state.captcha = false
})

test("a check-in the site fails keeps its words", async () => {
  state.checkedIn = false
  state.claimStatus = 500
  const out = await plugin.auth.checkin(async () => record())
  assert.equal(out.outcome, "failed")
  assert.match(out.message, /服务暂时不可用/)
  state.claimStatus = 200
  state.checkedIn = true
})

// ---- the site ---------------------------------------------------------------

function record() {
  return { type: "oauth", access: ACCESS, refresh: REFRESH, expires: Date.now() + 3600_000, accountId: "sube" }
}

function jwt(claims) {
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const body = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")
  return `${head}.${body}.signature`
}

function checkinRecord() {
  return {
    enabled: true,
    checked_in: state.checkedIn,
    amount: state.checkedIn ? 0.011 : 0,
    streak: 1,
    continuous_streak: 1,
    next_at: "2026-11-10T00:00:00+08:00",
    locked: false,
    frozen_amount: 0,
    today_frozen: false,
  }
}

function handle(req, res) {
  const { pathname: path } = new URL(req.url, "http://127.0.0.1")
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" })
    res.end(JSON.stringify(body))
  }
  const ok = (data) => send(200, { code: 0, message: "success", data })
  const key = String(req.headers.authorization ?? "").replace("Bearer ", "")

  if (path === "/api/v1/settings/public") {
    return ok({ turnstile_enabled: false, checkin_captcha_enabled: state.captcha })
  }
  if (path === "/api/v1/auth/me") {
    return ok({ id: 822, username: "sube", email: "sube@example.com", balance: state.balance, frozen_balance: 0 })
  }
  if (path === "/api/v1/activity/checkin") {
    if (req.method === "POST") {
      if (state.claimStatus !== 200) return send(state.claimStatus, { code: state.claimStatus, message: "服务暂时不可用" })
      state.checkedIn = true
    }
    return ok(checkinRecord())
  }
  if (path === "/v1/models") {
    if (state.refused.includes(key)) return send(401, { error: { message: "invalid token" } })
    const ids = state.groups[key] ?? []
    return send(200, { data: ids.map((id) => ({ id, display_name: id.toUpperCase() })) })
  }
  if (path === "/v1/chat/completions") {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => {
      const model = JSON.parse(body || "{}").model
      if (state.refused.includes(key)) return send(401, { error: { message: "invalid token" } })
      state.used.push({ model, key })
      send(200, { served: model, key })
    })
    return
  }
  return send(404, { code: 404, message: "not found" })
}
