import assert from "node:assert/strict"
import test from "node:test"

import { SessionKeeper, withRenewal } from "../src/session.mjs"
import { YydsApi } from "../src/api.mjs"
import { bad, makeFetch, ok, token } from "./helpers.mjs"

function keeper(handler, saved = []) {
  const { fetchImpl, calls } = makeFetch(handler)
  const session = new SessionKeeper({
    api: new YydsApi({ fetchImpl }),
    save: async (record) => saved.push(record),
  })
  return { session, calls, saved }
}

test("a token with time left is used as it is", async () => {
  const { session, calls } = keeper(() => ok({}))
  const record = { type: "oauth", access: token(3600), refresh: "r1" }
  const out = await session.current(record)
  assert.equal(out.renewed, false)
  assert.equal(out.record.access, record.access)
  assert.equal(calls.length, 0)
})

test("a token near its end is renewed once for every caller", async () => {
  const fresh = token(3600, { user_id: 822 })
  const { session, calls, saved } = keeper((url, init) => {
    if (!url.endsWith("/auth/refresh")) return bad(404, "not found")
    assert.deepEqual(init.body, JSON.stringify({ refresh_token: "r1" }))
    return ok({ access_token: fresh, refresh_token: "r2", expires_in: 3600 })
  })
  const record = { type: "oauth", access: token(10), refresh: "r1", expires: Date.now() + 10_000 }
  const [a, b, c] = await Promise.all([session.current(record), session.current(record), session.current(record)])
  assert.equal(calls.filter((call) => call.url.endsWith("/auth/refresh")).length, 1, "the refresh token is spent once")
  for (const out of [a, b, c]) {
    assert.equal(out.record.access, fresh)
    assert.equal(out.record.refresh, "r2")
    assert.equal(out.renewed, true)
  }
  assert.ok(saved.length >= 1)
})

test("the renewal keeps the account's own fields", async () => {
  const fresh = token(3600)
  const { session } = keeper(() => ok({ access_token: fresh, refresh_token: "r2" }))
  const record = { type: "oauth", access: token(5), refresh: "r1", accountId: "sube", apiKey: "sk-keep", keyId: 7 }
  const out = await session.current(record)
  assert.equal(out.record.accountId, "sube")
  assert.equal(out.record.apiKey, "sk-keep")
  assert.equal(out.record.keyId, 7)
})

test("a refresh token the site refuses is a sign-in that has ended", async () => {
  const { session } = keeper(() => bad(401, "invalid refresh token", { reason: "REFRESH_TOKEN_INVALID" }))
  await assert.rejects(session.current({ type: "oauth", access: token(5), refresh: "gone" }), (error) => {
    assert.equal(error.signedOut, true)
    assert.match(error.message, /登录已失效/)
    return true
  })
})

test("an ended token with nothing to renew it with asks for a sign-in again", async () => {
  const { session } = keeper(() => ok({}))
  await assert.rejects(session.current({ type: "oauth", access: token(-10), expires: Date.now() - 10_000 }), (error) => {
    assert.equal(error.signedOut, true)
    return true
  })
})

test("withRenewal renews after a refused read, once", async () => {
  const fresh = token(3600)
  const { session, calls } = keeper(() => ok({ access_token: fresh, refresh_token: "r2" }))
  const record = { type: "oauth", access: token(3500), refresh: "r1" }
  let tried = 0
  const out = await withRenewal(session, record, (current) => {
    tried += 1
    if (current.access !== fresh) {
      const error = new Error("refused")
      error.signedOut = true
      throw error
    }
    return { outcome: "done", token: current.access }
  })
  assert.equal(tried, 2)
  assert.equal(out.outcome, "done")
  assert.equal(calls.length, 1)
})
