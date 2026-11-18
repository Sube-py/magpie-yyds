// The site's own usage: what the dashboard shows as 今日消费 and 今日用量.
//
// `GET /usage/dashboard/snapshot-v2?timezone=…` answers the last days as
// `trend` (a row a day: requests, tokens, `cost` at list price, `actual_cost`
// what the group's multiplier charges) and `models` over the same days. The
// dashboard's 今日消费 is today's `actual_cost` — measured against the site's
// own page on 2026-11-18: 3.045654 there, 3.0457 here.
//
// It is the account's usage, not this plugin's: requests another client or
// another machine made are in it too, which is the point — a prepaid balance
// falls for all of them.

const TZ = "Asia/Shanghai"
const DAYS = 7

/** Today as the site counts days (`2026-11-18`), in the site's zone. */
export function siteToday(now = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

export class UsageDashboard {
  #api

  constructor({ api } = {}) {
    this.#api = api
  }

  /** The snapshot, or null when the site doesn't answer one. */
  async snapshot(token) {
    try {
      const data = await this.#api.data(`/usage/dashboard/snapshot-v2?timezone=${encodeURIComponent(TZ)}`, { token })
      const trend = Array.isArray(data?.trend) ? data.trend : []
      const models = Array.isArray(data?.models) ? data.models : []
      return { days: trend.map(rowOf), models: models.map(rowOf) }
    } catch {
      // a dashboard the site won't answer is no numbers, not a failed card
      return null
    }
  }

  /** One day's row, by the site's own date. */
  async today(token) {
    const snapshot = await this.snapshot(token)
    if (!snapshot) return null
    return snapshot.days.find((day) => day.date === siteToday()) ?? null
  }
}

function rowOf(row) {
  return {
    date: String(row?.date ?? ""),
    model: String(row?.model ?? ""),
    requests: count(row?.requests),
    tokens: count(row?.total_tokens ?? (count(row?.input_tokens) + count(row?.output_tokens) + count(row?.cache_read_tokens))),
    cost: amount(row?.cost),
    actual: amount(row?.actual_cost),
  }
}

function count(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function amount(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export { DAYS }
