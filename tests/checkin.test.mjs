import assert from "node:assert/strict"
import test from "node:test"

import { CheckinService, claimed, decide } from "../src/checkin.mjs"
import { YydsApi } from "../src/api.mjs"
import { bad, makeFetch, ok, token } from "./helpers.mjs"

const NEXT_AT = "2026-11-10T00:00:00+08:00"

function record() {
  return { type: "oauth", access: token() }
}

/** A site whose check-in is in the state given, and whose claim answers as told. */
function site({ status = {}, claim = null, settings = { checkin_captcha_enabled: false } } = {}) {
  return makeFetch((url, init) => {
    if (url.endsWith("/settings/public")) return ok(settings)
    if (url.endsWith("/activity/checkin")) {
      if (init.method === "POST") return claim ?? ok(status)
      return ok(status)
    }
    return bad(404, "not found")
  })
}

test("a site with the check-in switched off is inactive", async () => {
  const { fetchImpl } = site({ status: { enabled: false } })
  const out = await new CheckinService({ api: new YydsApi({ fetchImpl }) }).run(record())
  assert.equal(out.outcome, "inactive")
  assert.match(out.message, /没有开启/)
})

test("a day already in is done, with what it gave and when the site's day turns", async () => {
  const { fetchImpl, calls } = site({
    status: { enabled: true, checked_in: true, amount: 0.011, continuous_streak: 3, next_at: NEXT_AT },
  })
  const out = await new CheckinService({ api: new YydsApi({ fetchImpl }) }).run(record())
  assert.equal(out.outcome, "done")
  assert.equal(out.credit, 0.011)
  assert.equal(out.streak, 3)
  assert.equal(out.until, new Date(NEXT_AT).toISOString())
  assert.equal(calls.filter((c) => c.method === "POST").length, 0, "a day already in is never claimed again")
})

test("a frozen reward is today's, and says so", async () => {
  const { fetchImpl } = site({
    status: { enabled: true, checked_in: true, today_frozen: true, amount: 0.01, frozen_amount: 0.37, next_at: NEXT_AT },
  })
  const out = await new CheckinService({ api: new YydsApi({ fetchImpl }) }).run(record())
  assert.equal(out.outcome, "done")
  assert.equal(out.credit, undefined)
  assert.match(out.message, /冻结/)
  assert.match(out.message, /0\.370/)
})

test("a locked account can't take part", () => {
  const out = decide({ enabled: true, checked_in: false, locked: true, next_at: NEXT_AT })
  assert.equal(out.outcome, "ineligible")
  assert.match(out.message, /锁定/)
})

test("a day not in yet is claimed, and its answer is the claim's", async () => {
  const pending = { enabled: true, checked_in: false, min_amount: 0.005, max_amount: 0.015, next_at: NEXT_AT }
  const { fetchImpl, calls } = site({
    status: pending,
    claim: ok({ ...pending, checked_in: true, amount: 0.013, continuous_streak: 2, next_at: NEXT_AT }),
  })
  const out = await new CheckinService({ api: new YydsApi({ fetchImpl }) }).run(record())
  assert.equal(out.outcome, "claimed")
  assert.equal(out.credit, 0.013)
  assert.equal(out.streak, 2)
  assert.equal(out.until, new Date(NEXT_AT).toISOString())
  assert.equal(calls.filter((c) => c.method === "POST").length, 1)
  assert.equal(calls.find((c) => c.method === "POST").body, undefined, "no captcha means no body")
})

test("a claim that refuses because the day is in is done, not failed", async () => {
  const { fetchImpl } = site({
    status: { enabled: true, checked_in: false },
    claim: bad(400, "今日已签到"),
  })
  const out = await new CheckinService({ api: new YydsApi({ fetchImpl }) }).run(record())
  assert.equal(out.outcome, "done")
})

test("a captcha-guarded check-in is left to the site's own page", async () => {
  const { fetchImpl, calls } = site({
    status: { enabled: true, checked_in: false },
    settings: { checkin_captcha_enabled: true },
  })
  const out = await new CheckinService({ api: new YydsApi({ fetchImpl }) }).run(record())
  assert.equal(out.outcome, "captcha")
  assert.equal(calls.filter((c) => c.method === "POST").length, 0, "never claims what it can't prove")
})

test("a captcha proof a person solved is sent with the claim", async () => {
  const { fetchImpl, calls } = site({
    status: { enabled: true, checked_in: false },
    claim: ok({ enabled: true, checked_in: true, amount: 0.01 }),
  })
  const out = await new CheckinService({ api: new YydsApi({ fetchImpl }) }).run(record(), { proof: "solved" })
  assert.equal(out.outcome, "claimed")
  assert.deepEqual(calls.find((c) => c.method === "POST").body, { proof: "solved" })
})

test("a site-side failure is the day's failure, with its words", async () => {
  const { fetchImpl } = site({ status: { enabled: true, checked_in: false }, claim: bad(500, "服务暂时不可用") })
  const out = await new CheckinService({ api: new YydsApi({ fetchImpl }) }).run(record())
  assert.equal(out.outcome, "failed")
  assert.match(out.message, /服务暂时不可用/)
})

test("an expired sign-in says to sign in again", async () => {
  const { fetchImpl } = makeFetch(() => bad(401, "Authorization header is required"))
  const out = await new CheckinService({ api: new YydsApi({ fetchImpl }) }).run(record())
  assert.equal(out.outcome, "failed")
  assert.match(out.message, /登录已失效/)
})

test("a site that never answers throws, for magpie's shorter retry", async () => {
  const api = new YydsApi({
    fetchImpl: async () => {
      throw new Error("ETIMEDOUT")
    },
  })
  await assert.rejects(new CheckinService({ api }).run(record()), (error) => error.status === 0)
})

test("a claim's record reads as today's check-in", () => {
  const out = claimed({ checked_in: true, amount: 0.02, streak: 4, next_at: NEXT_AT })
  assert.deepEqual(out, {
    outcome: "claimed",
    credit: 0.02,
    streak: 4,
    message: "签到成功",
    until: new Date(NEXT_AT).toISOString(),
  })
})
