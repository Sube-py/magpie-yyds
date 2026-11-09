import assert from "node:assert/strict"
import test from "node:test"

import { YydsApi } from "../src/api.mjs"
import { UsageReporter, userOf, walletWindow } from "../src/usage.mjs"
import { bad, makeFetch, ok, token } from "./helpers.mjs"

function reporter(handler) {
  const { fetchImpl, calls } = makeFetch(handler)
  return { usage: new UsageReporter({ api: new YydsApi({ fetchImpl }) }), calls }
}

test("the card reads the account's wallet", async () => {
  const { usage, calls } = reporter(() =>
    ok({ id: 822, username: "sube", email: "sube@example.com", balance: 79.190222963, frozen_balance: 0 }),
  )
  const out = await usage.report({ type: "oauth", access: token() })
  assert.equal(out.user, "sube")
  assert.equal(out.balance, "$79.19")
  assert.equal(out.signIn, "kept")
  assert.deepEqual(out.windows, [{ name: "余额", balance: 79.190222963, unit: "USD", display: "$79.19" }])
  assert.equal(calls[0].url, "https://www.yydsapi.uno/api/v1/auth/me")
})

test("a frozen balance is said beside the wallet", async () => {
  const { usage } = reporter(() => ok({ username: "sube", balance: 3, frozen_balance: 0.5 }))
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

test("the wallet is a figure, in its own unit", () => {
  assert.deepEqual(walletWindow(12.5), { name: "余额", balance: 12.5, unit: "USD", display: "$12.50" })
})

test("the card's name comes from what the site calls the account", () => {
  assert.equal(userOf({ username: "sube", email: "a@b.c" }), "sube")
  assert.equal(userOf({ email: "a@b.c" }), "a@b.c")
  assert.equal(userOf({}, { username: "kept" }), "kept")
  assert.equal(userOf({}), "")
})
