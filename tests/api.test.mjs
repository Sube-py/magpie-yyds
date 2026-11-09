import assert from "node:assert/strict"
import test from "node:test"

import { YydsApi } from "../src/api.mjs"
import { YydsError } from "../src/errors.mjs"
import { bad, makeFetch, ok, token } from "./helpers.mjs"

test("a REST call gives back its data", async () => {
  const { fetchImpl, calls } = makeFetch(() => ok({ username: "sube" }))
  const api = new YydsApi({ fetchImpl })
  const data = await api.data("/auth/me", { token: "abc" })
  assert.deepEqual(data, { username: "sube" })
  assert.equal(calls[0].url, "https://www.yydsapi.uno/api/v1/auth/me")
  assert.equal(calls[0].init.headers.Authorization, "Bearer abc")
})

test("the site's refusal keeps its words, code and status", async () => {
  const { fetchImpl } = makeFetch(() => bad(401, "invalid refresh token", { reason: "REFRESH_TOKEN_INVALID" }))
  const api = new YydsApi({ fetchImpl })
  await assert.rejects(api.data("/auth/refresh", { method: "POST", body: { refresh_token: "x" } }), (error) => {
    assert.ok(error instanceof YydsError)
    assert.equal(error.message, "invalid refresh token")
    assert.equal(error.status, 401)
    assert.equal(error.reason, "REFRESH_TOKEN_INVALID")
    assert.equal(error.signedOut, true)
    assert.equal(error.transient, false)
    return true
  })
})

test("a 200 with a code that isn't 0 is a refusal too", async () => {
  const { fetchImpl } = makeFetch(() => ({ body: { code: 40001, message: "余额不足" } }))
  const api = new YydsApi({ fetchImpl })
  await assert.rejects(api.data("/keys"), /余额不足/)
})

test("an answer that isn't JSON says so with its status", async () => {
  const { fetchImpl } = makeFetch(() => ({ status: 404, body: "404 page not found", contentType: "text/plain" }))
  const api = new YydsApi({ fetchImpl })
  await assert.rejects(api.data("/nope"), (error) => {
    assert.equal(error.status, 404)
    assert.match(error.message, /读不懂/)
    return true
  })
})

test("a site that can't be reached is transient, not signed out", async () => {
  const api = new YydsApi({
    fetchImpl: async () => {
      throw new Error("getaddrinfo ENOTFOUND")
    },
  })
  await assert.rejects(api.data("/auth/me"), (error) => {
    assert.equal(error.status, 0)
    assert.equal(error.transient, true)
    assert.equal(error.signedOut, false)
    return true
  })
})

test("the OpenAI base takes the key, and a refusal reads as its message", async () => {
  const { fetchImpl, calls } = makeFetch((url) =>
    url.endsWith("/models") ? { body: { data: [{ id: "glm-5.3" }] } } : { status: 401, body: { error: { message: "invalid token" } } },
  )
  const api = new YydsApi({ fetchImpl })
  const listed = await api.openai("/models", { key: "sk-test" })
  assert.deepEqual(listed.data, [{ id: "glm-5.3" }])
  assert.equal(calls[0].url, "https://www.yydsapi.uno/v1/models")
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test")
  await assert.rejects(api.openai("/chat/completions", { key: "sk-test" }), (error) => {
    assert.equal(error.status, 401)
    assert.equal(error.message, "invalid token")
    return true
  })
})

test("a session token is sent as the site wants it", async () => {
  const { fetchImpl, calls } = makeFetch(() => ok({}))
  const api = new YydsApi({ fetchImpl })
  await api.data("/activity/checkin", { token: token() })
  assert.match(calls[0].init.headers.Authorization, /^Bearer ey/)
})
