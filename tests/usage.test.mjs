import assert from "node:assert/strict"
import test from "node:test"

import { YydsApi } from "../src/api.mjs"
import { UsageReporter, balanceWindow, spendWindow, tokensShort, usageWindow, userOf } from "../src/usage.mjs"
import { siteToday } from "../src/dashboard.mjs"
import { bad, makeFetch, ok, token } from "./helpers.mjs"

function reporter(handler, { today = null } = {}) {
  const { fetchImpl, calls } = makeFetch(handler)
  const dashboard = { today: async (token) => (assert.ok(token, "the dashboard is read with the account's session"), today) }
  return { usage: new UsageReporter({ api: new YydsApi({ fetchImpl }), dashboard }), calls }
}

test("the card reads the account's wallet, as a share of what was paid in", async () => {
  const { usage, calls } = reporter(() =>
    ok({ id: 822, username: "sube", email: "sube@example.com", balance: 43.183359089, frozen_balance: 0, total_recharged: 266.548 }),
  )
  const out = await usage.report({ type: "oauth", access: token() })
  assert.equal(out.user, "sube")
  assert.equal(out.balance, "$43.18")
  assert.equal(out.signIn, "kept")
  const [window] = out.windows
  assert.equal(window.name, "余额")
  assert.equal(window.used.toFixed(1), "83.8", "the share is what the curve and the meter read")
  assert.equal(window.amount, undefined, "no count: magpie would count it day by day")
  assert.equal(window.limit, undefined)
  assert.equal(window.aside, undefined, "a share is not set aside: magpie keeps its history")
  assert.equal(window.family, undefined, "a family would hide the curve")
  assert.equal(window.balance, undefined)
  assert.match(window.display, /\$43\.18（累计充值 \$266\.55）/)
  assert.equal(calls[0].url, "https://www.yydsapi.uno/api/v1/auth/me")
})

test("a frozen balance is said beside the wallet", async () => {
  const { usage } = reporter(() => ok({ username: "sube", balance: 3, frozen_balance: 0.5, total_recharged: 20 }))
  const out = await usage.report({ type: "oauth", access: token() })
  assert.match(out.windows[0].display, /冻结 \$0\.50/)
})

test("a refused read says to sign in again, not that the account is empty", async () => {
  const { usage } = reporter(() => bad(401, "Authorization header is required"))
  const out = await usage.report({ type: "oauth", access: token() })
  assert.equal(out.signIn, "expired")
  assert.match(out.error, /Authorization/)
})

test("a site failure leaves the sign-in alone", async () => {
  const { usage } = reporter(() => bad(503, "服务暂时不可用"))
  const out = await usage.report({ type: "oauth", access: token() })
  assert.equal(out.signIn, "kept")
  assert.match(out.error, /服务暂时不可用/)
})

test("with no total paid in, the wallet is set aside and no share is invented", () => {
  // magpie: a window with balance but no used and no aside keeps Used 0, which
  // the card draws as 100% left and the history as a flat 100% line
  const wallet = balanceWindow(79.19)
  assert.equal(wallet.aside, true)
  assert.equal(wallet.used, undefined)
  assert.equal(wallet.limit, undefined)
})

test("a balance above what was ever paid in is no share either", () => {
  // gift credits can lift the balance over the total: a share would be negative
  assert.equal(balanceWindow(300, 0, 266.548).aside, true)
})

test("the share moves the way a wallet moves: spent down, topped up", () => {
  const before = balanceWindow(50, 0, 200)
  const spent = balanceWindow(40, 0, 200)
  const toppedUp = balanceWindow(90, 0, 250)
  assert.ok(spent.used > before.used, "spending raises the share used")
  assert.ok(toppedUp.used < before.used, "a top-up raises the total and the balance")
  assert.equal(before.unit, "USD")
  assert.equal(before.display.includes(" / "), false, "not 'used / total': that reads as credits")
})

test("the wallet is a figure, in its own unit", () => {
  assert.deepEqual(balanceWindow(12.5), { name: "余额", balance: 12.5, unit: "USD", display: "$12.50", aside: true })
})

test("the card's name comes from what the site calls the account", () => {
  assert.equal(userOf({ username: "sube", email: "a@b.c" }), "sube")
  assert.equal(userOf({ email: "a@b.c" }), "a@b.c")
  assert.equal(userOf({}, { username: "kept" }), "kept")
  assert.equal(userOf({}), "")
})

const TODAY = { date: "2026-11-18", requests: 104, tokens: 29_354_600, cost: 29.3546, actual: 3.0457 }

test("today's spend is an amount, with no meter and no curve of its own", () => {
  const window = spendWindow(TODAY)
  assert.equal(window.name, "今日消费")
  assert.equal(window.display, "$3.05")
  assert.equal(window.aside, true)
  assert.equal(window.used, undefined, "no share: the balance's line is the only one")
  assert.equal(window.amount, undefined)
  assert.equal(window.limit, undefined)
})

test("a day with nothing spent still reads as an amount", () => {
  assert.equal(spendWindow({ ...TODAY, actual: 0 }).display, "$0.00")
  assert.equal(spendWindow(null).display, "$0.00")
})

test("today's calls and tokens read as the site's dashboard writes them", () => {
  const window = usageWindow(TODAY)
  assert.equal(window.name, "今日用量")
  assert.equal(window.display, "104 次 · 29.4M tokens")
  assert.equal(window.aside, true)
  assert.equal(usageWindow(null), null)
  assert.equal(usageWindow({ date: "x", requests: 0, tokens: 0 }), null)
})

test("counts are shortened the way the site shortens them", () => {
  assert.equal(tokensShort(58), "58")
  assert.equal(tokensShort(1037), "1.0K")
  assert.equal(tokensShort(29_354_600), "29.4M")
  assert.equal(tokensShort(829_000_000), "829.0M")
  assert.equal(tokensShort(2_500_000_000), "2.5B")
})

test("the card carries the wallet, today's spend and today's usage", async () => {
  const { usage } = reporter(
    (url) =>
      url.endsWith("/auth/me")
        ? ok({ username: "sube", balance: 43.183359089, frozen_balance: 0, total_recharged: 266.548 })
        : ok({}),
    { today: TODAY },
  )
  const out = await usage.report({ type: "oauth", access: token() })
  assert.deepEqual(out.windows.map((w) => w.name), ["余额", "今日消费", "今日用量"])
  assert.equal(out.windows[1].display, "$3.05")
  assert.equal(out.windows[1].aside, true)
  assert.deepEqual(
    out.windows.filter((w) => w.used !== undefined).map((w) => w.name),
    ["余额"],
    "one curve only: the balance's",
  )
})

test("the site's own day is counted in its zone", () => {
  // 2026-11-18 16:30 in Shanghai is 08:30 UTC
  assert.equal(siteToday(new Date("2026-11-18T08:30:00Z")), "2026-11-18")
  // 2026-11-18 00:30 in Shanghai is still 2026-11-17 in UTC
  assert.equal(siteToday(new Date("2026-11-17T16:30:00Z")), "2026-11-18")
})
