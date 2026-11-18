import assert from "node:assert/strict"
import test from "node:test"

import { balanceCurve, byModel, dailySpend, range, requestOf, siteDay, summary } from "../lib/site.mjs"

const TZ = "Asia/Shanghai"
const at = (iso) => Date.parse(iso)

/** A ledger as the site writes it: what each request was charged, and when. */
function ledger() {
  return [
    { created_at: "2026-11-16T10:00:00+08:00", model: "gpt-6.1-sol", input_tokens: 100, output_tokens: 10, cache_read_tokens: 1000, actual_cost: 2, total_cost: 20 },
    { created_at: "2026-11-17T10:00:00+08:00", model: "glm-5.3", input_tokens: 200, output_tokens: 20, cache_read_tokens: 2000, actual_cost: 2.3511, total_cost: 23.511 },
    { created_at: "2026-11-18T09:00:00+08:00", model: "glm-5.3", input_tokens: 300, output_tokens: 30, cache_read_tokens: 3000, actual_cost: 3.045654, total_cost: 30.45654 },
  ].map(requestOf)
}

test("a ledger row keeps what the page shows", () => {
  const [row] = ledger()
  assert.equal(row.model, "gpt-6.1-sol")
  assert.equal(row.cost, 2, "actual_cost: what the group charged")
  assert.equal(row.listCost, 20, "total_cost: the list price")
  assert.equal(row.tokens, 1110, "input + output + cache read")
  assert.equal(row.at, at("2026-11-16T10:00:00+08:00"))
})

test("the balance curve climbs back from today by what was spent", () => {
  const curve = balanceCurve(ledger(), { balanceNow: 43.18, now: at("2026-11-18T12:00:00+08:00") })
  assert.equal(curve.length, 4)
  assert.equal(curve.at(-1).amount, 43.18, "today's balance is the last point")
  assert.equal(curve.at(-2).amount, 46.23, "before today's spend it was 43.18 + 3.05")
  assert.equal(curve.at(-3).amount, 48.58, "and before yesterday's, 2.35 more")
  assert.equal(curve[0].amount, 50.58, "the oldest request's spend still in the balance")
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i].at >= curve[i - 1].at, "oldest first")
})

test("a curve with one point is no curve", () => {
  assert.equal(balanceCurve([], { balanceNow: 43.18 }).length, 1)
})

test("a curve keeps its shape without every point", () => {
  const many = Array.from({ length: 5000 }, (_, i) => ({ at: 1_700_000_000_000 + i * 60_000, cost: 0.01 }))
  const curve = balanceCurve(many, { balanceNow: 1, max: 100 })
  assert.ok(curve.length <= 102, `thinned to ${curve.length}`)
  assert.equal(curve.at(-1).amount, 1)
})

test("daily spend fills the days between the ends, zero days included", () => {
  const days = dailySpend(ledger(), { from: "2026-11-16", to: "2026-11-18", zone: TZ })
  assert.deepEqual(days.map((d) => d.date), ["2026-11-16", "2026-11-17", "2026-11-18"])
  assert.equal(days[0].cost, 2)
  assert.equal(days[2].cost, 3.05, "rounded to cents")
  assert.equal(days[2].requests, 1)
  const gap = dailySpend([], { from: "2026-11-16", to: "2026-11-18", zone: TZ })
  assert.deepEqual(gap.map((d) => d.cost), [0, 0, 0])
})

test("the site's day is the site's, not the machine's", () => {
  // 2026-11-18 00:30 in Shanghai is still the 17th in UTC
  assert.equal(siteDay(at("2026-11-17T16:30:00Z")), "2026-11-18")
  assert.equal(siteDay(at("2026-11-18T15:59:00Z")), "2026-11-18")
  assert.equal(siteDay(at("2026-11-18T16:01:00Z")), "2026-11-19")
})

test("models are gathered and ranked by what they cost", () => {
  const models = byModel(ledger())
  assert.equal(models[0].model, "glm-5.3")
  assert.equal(models[0].cost, 5.4, "2.35 + 3.05, rounded")
  assert.equal(models[0].requests, 2)
  assert.equal(models[1].model, "gpt-6.1-sol")
})

test("the summary is what the page draws", () => {
  const me = { username: "sube", balance: 43.183359089, frozen_balance: 0, total_recharged: 266.548 }
  const data = summary({ me, requests: ledger(), from: "2026-11-16", to: "2026-11-18", now: at("2026-11-18T12:00:00+08:00") })
  assert.equal(data.user, "sube")
  assert.equal(data.balance, 43.18)
  assert.equal(data.recharged, 266.55)
  assert.equal(data.today.cost, 3.05)
  assert.equal(data.spent, 7.4, "2 + 2.35 + 3.05")
  assert.equal(data.requests, 3)
  assert.equal(data.curve.at(-1).amount, 43.18)
  assert.equal(data.recent[0].model, "glm-5.3", "newest first")
  assert.equal(data.toppedUp, false, "43.18 + 7.4 is well under what was paid in")
})

test("a top-up in the window is said, not hidden", () => {
  const me = { username: "sube", balance: 300, frozen_balance: 0, total_recharged: 100 }
  const data = summary({ me, requests: ledger(), from: "2026-11-16", to: "2026-11-18", now: at("2026-11-18T12:00:00+08:00") })
  assert.equal(data.toppedUp, true, "the balance plus spend is over what was ever paid in")
})

test("a range is whole site days, ending today", () => {
  const { from, to } = range(7, new Date("2026-11-18T12:00:00+08:00"))
  assert.equal(to, "2026-11-18")
  assert.equal(from, "2026-11-11")
})

/** A site that fails the first `failures` asks, then answers. */
function flakySite(failures, payload) {
  let asked = 0
  return {
    fetchImpl: async () => {
      asked++
      if (asked <= failures) throw new Error("fetch failed")
      return new Response(JSON.stringify({ code: 0, data: payload }), { status: 200 })
    },
    asked: () => asked,
  }
}

test("a dropped connection is tried again, not turned into a failure", async () => {
  const { SiteUsage } = await import("../lib/site.mjs")
  const site = flakySite(2, { items: [], pages: 1 })
  const client = new SiteUsage({ fetchImpl: site.fetchImpl, origin: "https://example.test" })
  const rows = await client.requests("tok", { from: "2026-11-18", to: "2026-11-18" })
  assert.deepEqual(rows, [])
  assert.equal(site.asked(), 3, "two failed asks, the third answered")
})

test("a page that never answers leaves what came before it, marked partial", async () => {
  const { SiteUsage } = await import("../lib/site.mjs")
  let page = 0
  const fetchImpl = async (url) => {
    page++
    if (String(url).includes("page=2")) throw new Error("fetch failed")
    return new Response(
      JSON.stringify({
        code: 0,
        data: { items: [{ created_at: "2026-11-18T09:00:00+08:00", model: "glm-5.3", actual_cost: 1 }], pages: 3 },
      }),
      { status: 200 },
    )
  }
  const client = new SiteUsage({ fetchImpl, origin: "https://example.test" })
  const rows = await client.requests("tok", { from: "2026-11-18", to: "2026-11-18" })
  assert.equal(rows.length, 1, "page 1's row is kept")
  assert.equal(rows.partial, true)
})
