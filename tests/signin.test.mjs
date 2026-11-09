import assert from "node:assert/strict"
import test from "node:test"

import { YydsApi } from "../src/api.mjs"
import { SignInService, readSession } from "../src/signin.mjs"
import { bad, makeFetch, ok, token } from "./helpers.mjs"

const ACCESS = token(3600, { user_id: 822, email: "sube@example.com" })
const REFRESH = "rt-abc123"
const KEY = `sk-${"c".repeat(24)}`

function signin(handler) {
  const { fetchImpl, calls } = makeFetch(handler)
  return { signin: new SignInService({ api: new YydsApi({ fetchImpl }) }), calls }
}

/** The site as it answers a signed-in account. */
function site(extra = {}) {
  return (url, init) => {
    if (url.endsWith("/settings/public")) {
      return ok({ turnstile_enabled: false, geetest_captcha_enabled: false, ...extra.settings })
    }
    if (url.endsWith("/auth/login") && init.method === "POST") {
      return ok({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, user: { id: 822 } })
    }
    if (url.endsWith("/auth/refresh") && init.method === "POST") {
      return ok({ access_token: ACCESS, refresh_token: "rt-new", expires_in: 3600 })
    }
    if (url.endsWith("/auth/me")) return ok({ id: 822, username: "sube", email: "sube@example.com", balance: 79.19 })
    if (url.endsWith("/v1/models")) return { body: { data: [{ id: "glm-5.3" }] } }
    return bad(404, "not found")
  }
}

test("a password sign-in keeps the account and its tokens, and no key", async () => {
  const { signin: service, calls } = signin(site())
  const out = await service.password({ email: "sube@example.com", password: "hunter2" })
  assert.equal(out.type, "success")
  assert.equal(out.accountId, "sube")
  assert.equal(out.uid, "822")
  assert.equal(out.access, ACCESS)
  assert.equal(out.refresh, REFRESH)
  assert.ok(out.expires > Date.now())
  assert.equal(out.apiKey, undefined, "keys are added in the provider, not here")
  assert.equal(calls.filter((call) => call.url.includes("/keys")).length, 0, "the key list isn't read either")
})

test("a wrong password is the site's own refusal", async () => {
  const { signin: service } = signin(() => bad(401, "invalid email or password", { reason: "INVALID_CREDENTIALS" }))
  await assert.rejects(service.password({ email: "sube@example.com", password: "nope" }), /invalid email or password/)
})

test("a login behind a captcha is sent to the browser-session way", async () => {
  const { signin: service } = signin(site({ settings: { turnstile_enabled: true } }))
  await assert.rejects(service.password({ email: "sube@example.com", password: "hunter2" }), /人机验证/)
})

test("missing fields are refused before anything is asked of the site", async () => {
  const { signin: service, calls } = signin(site())
  await assert.rejects(service.password({ email: "", password: "x" }), /邮箱和密码/)
  await assert.rejects(service.password({ email: "sube@example.com" }), /邮箱和密码/)
  assert.equal(calls.length, 0)
})

test("a pasted access token is checked, then kept", async () => {
  const { signin: service } = signin(site())
  const out = await service.paste({ session: ACCESS })
  assert.equal(out.access, ACCESS)
  assert.equal(out.refresh, undefined, "no refresh token was pasted, none is made up")
  assert.equal(out.apiKey, undefined)
})

test("the site's localStorage JSON reads as its session", async () => {
  const { signin: service } = signin(site())
  const json = JSON.stringify({ auth_token: ACCESS, refresh_token: REFRESH, token_expires_at: "1794278834634" })
  const out = await service.paste({ session: json })
  assert.equal(out.access, ACCESS)
  assert.equal(out.refresh, REFRESH)
})

test("a refresh token alone is exchanged for a session", async () => {
  const { signin: service, calls } = signin(site())
  const out = await service.paste({ session: REFRESH })
  assert.equal(out.access, ACCESS)
  assert.equal(out.refresh, "rt-new")
  assert.ok(calls.some((call) => call.url.endsWith("/auth/refresh")))
})

test("an expired access token with a refresh token is renewed while signing in", async () => {
  const expired = token(-10)
  const { signin: service } = signin((url, init) => {
    if (url.endsWith("/auth/me") && init.headers.Authorization === `Bearer ${expired}`) return bad(401, "token expired")
    return site()(url, init)
  })
  const out = await service.paste({ session: JSON.stringify({ auth_token: expired, refresh_token: REFRESH }) })
  assert.equal(out.access, ACCESS)
})

test("a key pasted into the session way is sent to the plugin's keys", async () => {
  const { signin: service } = signin(site())
  await assert.rejects(service.paste({ session: KEY }), (error) => {
    assert.match(error.message, /API 密钥/)
    assert.match(error.message, /只因API 密钥」页面/)
    return true
  })
})

test("an unreadable paste says what to copy", async () => {
  const { signin: service } = signin(site())
  await assert.rejects(service.paste({ session: "{oops" }), /读不懂/)
  await assert.rejects(service.paste({ session: "   " }), /请粘贴/)
})

test("readSession reads the shapes a person can paste", () => {
  assert.deepEqual(readSession(ACCESS), { access: ACCESS, refresh: "" })
  assert.deepEqual(readSession(`refresh_token=${REFRESH}`), { access: "", refresh: REFRESH })
  assert.deepEqual(readSession(REFRESH), { access: "", refresh: REFRESH })
  assert.deepEqual(readSession(JSON.stringify({ auth_token: ACCESS })), { access: ACCESS, refresh: "" })
  assert.deepEqual(readSession(JSON.stringify({ data: { access_token: ACCESS, refresh_token: REFRESH } })), {
    access: ACCESS,
    refresh: REFRESH,
  })
  assert.deepEqual(readSession(""), { access: "", refresh: "" })
})
