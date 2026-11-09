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
    return {
      user: userOf(me, record),
      balance: `$${balance.toFixed(2)}`,
      windows: [walletWindow(balance, frozen)],
      signIn: renewed ? "renewed" : "kept",
    }
  }
}

/** The wallet, which has no total it is a share of: a figure, not a meter. */
export function walletWindow(balance, frozen = 0) {
  const display = frozen > 0 ? `$${balance.toFixed(2)} · 冻结 $${frozen.toFixed(2)}` : `$${balance.toFixed(2)}`
  return { name: "余额", balance, unit: "USD", display }
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
