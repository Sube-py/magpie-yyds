// What the account's usage card says.
//
// `GET /auth/me` carries the wallet: `balance` and `frozen_balance`, in US
// dollars (the dashboard's `$79.19`). It belongs to the account, so only an
// account signed in with its session has one — a key account reads nothing,
// and says so instead of looking empty.

export class UsageReporter {
  #api

  constructor({ api } = {}) {
    this.#api = api
  }

  async report(record, { renewed = false } = {}) {
    const token = record?.access
    if (!token) return { error: "还没登录只因API", signIn: "expired" }

    let me
    try {
      me = await this.#api.data("/auth/me", { token })
    } catch (error) {
      return {
        error: error?.message ?? String(error),
        signIn: error?.signedOut ? "expired" : "kept",
      }
    }
    const balance = number(me?.balance)
    const frozen = number(me?.frozen_balance)
    const recharged = number(me?.total_recharged)
    return {
      user: userOf(me, record),
      balance: `$${balance.toFixed(2)}`,
      windows: [walletWindow(balance, frozen, recharged)],
      signIn: renewed ? "renewed" : "kept",
    }
  }
}

/**
 * The wallet, as the site's own arithmetic makes it a share.
 *
 * A prepaid balance has no total of its own, and magpie draws no curve for a
 * window that says only `balance` — its card shows a figure and its history
 * nothing (a share nobody said would be a flat 100% line, #4825). But the site
 * does tell a total: `total_recharged`, everything ever paid in. Against that,
 * the balance is a share that moves the way a wallet moves — down as it is
 * spent, up when it is topped up (the total grows too) — so magpie keeps it as
 * a window with `amount`/`limit`, and its history draws the curve.
 *
 * A site that tells no total (a fresh account, credits only from gifts) keeps
 * the plain wallet: the figure, set aside, no invented curve.
 */
export function walletWindow(balance, frozen = 0, recharged = 0) {
  const frozenText = frozen > 0 ? ` · 冻结 $${frozen.toFixed(2)}` : ""
  const total = Number(recharged)
  if (Number.isFinite(total) && total > 0 && balance <= total) {
    const used = total - balance
    return {
      name: "余额",
      used: Math.min(100, Math.max(0, (100 * used) / total)),
      amount: used,
      limit: total,
      unit: "USD",
      display: `$${balance.toFixed(2)} / 累计充值 $${total.toFixed(2)}${frozenText}`,
    }
  }
  const display = `$${balance.toFixed(2)}${frozenText}`
  return { name: "余额", balance, unit: "USD", display, aside: true }
}

/** The account's name on the card: the site's username, else its email. */
export function userOf(me, record) {
  for (const value of [me?.username, me?.email, record?.username, record?.email]) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function number(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}
