// What the account's usage card says.
//
// `GET /auth/me` carries the wallet: `balance`, `frozen_balance`, and
// `total_recharged`, everything ever paid in — in US dollars (the dashboard's
// `$43.18`). The site's own usage dashboard carries what was spent, so the card
// shows the same three things its page does: 余额, 今日消费, 今日用量.
//
// Two of them are shares, because that is what magpie draws a curve from
// (quota-history): the balance against what was ever paid in, and today's
// spend against the balance the day started with. A day that has spent
// nothing is text, not a share at 0 — a share nobody said draws a flat line.

import { UsageDashboard } from "./dashboard.mjs"

export class UsageReporter {
  #api
  #dashboard

  constructor({ api, dashboard } = {}) {
    this.#api = api
    this.#dashboard = dashboard ?? new UsageDashboard({ api })
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
    const today = await this.#dashboard.today(token)
    return {
      user: userOf(me, record),
      balance: `$${balance.toFixed(2)}`,
      windows: [balanceWindow(balance, frozen, recharged), spendWindow(today), usageWindow(today)].filter(Boolean),
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
export function balanceWindow(balance, frozen = 0, recharged = 0) {
  const frozenText = frozen > 0 ? ` · 冻结 $${frozen.toFixed(2)}` : ""
  const total = Number(recharged)
  if (Number.isFinite(total) && total > 0 && balance <= total) {
    const used = total - balance
    // A share, and only a share: no `amount`/`limit`, and a display magpie
    // can't read as "used / total". With a count, magpie treats the window as a
    // pot of credits and adds its own "每天花掉的金额" row (and a daily chart),
    // which a prepaid balance has nothing to do with; without a count it draws
    // the share and keeps the history curve.
    return {
      name: "余额",
      used: Math.min(100, Math.max(0, (100 * used) / total)),
      unit: "USD",
      display: `$${balance.toFixed(2)}（累计充值 $${total.toFixed(2)}${frozenText}）`,
    }
  }
  const display = `$${balance.toFixed(2)}${frozenText}`
  return { name: "余额", balance, unit: "USD", display, aside: true }
}

/**
 * Today's spend, as the site's dashboard states it: an amount, nothing more.
 *
 * It is not a share and gets no curve — the day has no total it is part of, and
 * a share invented for it would draw a line of its own next to the balance's.
 */
export function spendWindow(today) {
  const spent = Number(today?.actual) || 0
  return { name: "今日消费", display: `$${spent.toFixed(2)}`, unit: "USD", aside: true }
}

/** Today's calls and tokens, as the site's dashboard counts them. */
export function usageWindow(today) {
  if (!today || (!today.requests && !today.tokens)) return null
  return {
    name: "今日用量",
    display: `${today.requests.toLocaleString("en-US")} 次 · ${tokensShort(today.tokens)} tokens`,
    aside: true,
  }
}

/** 1_234_567 as "1.2M", as the site's own dashboard writes it. */
export function tokensShort(n) {
  const v = Number(n) || 0
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(Math.round(v))
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
