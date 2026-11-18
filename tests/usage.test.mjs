import assert from "node:assert/strict"
import test from "node:test"

import { YydsApi } from "../src/api.mjs"
import { UsageReporter, userOf, walletWindow } from "../src/usage.mjs"
import { bad, makeFetch, ok, token } from "./helpers.mjs"

function reporter(handler) {
  const { fetchImpl, calls } = makeFetch(handler)
  return { usage: new UsageReporter({ api: new YydsApi({ fetchImpl }) }), calls }
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
  assert.equal(window.limit, 266.548, "everything paid in is the total")
  assert.equal(window.amount, 266.548 - 43.183359089, "what was spent of it")
  assert.equal(window.used.toFixed(1), "83.8")
  assert.equal(window.aside, undefined, "a share is not set aside: magpie keeps its history")
  assert.equal(window.balance, undefined)
  assert.match(window.display, /\$43\.18 \/ 累计充值 \$266\.55/)
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
  const wallet = walletWindow(79.19)
  assert.equal(wallet.aside, true)
  assert.equal(wallet.used, undefined)
  assert.equal(wallet.limit, undefined)
})

test("a balance above what was ever paid in is no share either", () => {
  // gift credits can lift the balance over the total: a share would be negative
  assert.equal(walletWindow(300, 0, 266.548).aside, true)
})

test("the share moves the way a wallet moves: spent down, topped up", () => {
  const before = walletWindow(50, 0, 200)
  const spent = walletWindow(40, 0, 200)
  const toppedUp = walletWindow(90, 0, 250)
  assert.ok(spent.used > before.used, "spending raises the share used")
  assert.ok(toppedUp.used < before.used, "a top-up raises the total and the balance")
  assert.equal(before.unit, "USD")
})

test("the wallet is a figure, in its own unit", () => {
  assert.deepEqual(walletWindow(12.5), { name: "余额", balance: 12.5, unit: "USD", display: "$12.50", aside: true })
})

test("the card's name comes from what the site calls the account", () => {
  assert.equal(userOf({ username: "sube", email: "a@b.c" }), "sube")
  assert.equal(userOf({ email: "a@b.c" }), "a@b.c")
  assert.equal(userOf({}, { username: "kept" }), "kept")
  assert.equal(userOf({}), "")
})
