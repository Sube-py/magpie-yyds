import { setDefaultResultOrder } from "node:dns"
// The site's own numbers, and the balance curve they make.
//
// The site answers a request-by-request ledger (`GET /usage?start_date=…`) with
// the cost each one was charged (`actual_cost`, the group's price, not the list
// price) and when it ran; `/auth/me` answers the balance now. From those two the
// balance at any earlier moment follows: everything charged after that moment is
// still in the balance, so
//
//     balance(t) = balance_now + Σ actual_cost of the requests after t
//
// which is what makes the curve: it walks backwards from today's balance and
// climbs by what was spent, so a day of spending shows as the step down it was.
// A top-up inside the window is not in this arithmetic (only spending is), so
// the curve says so rather than pretending.

// A machine whose IPv6 route is dead makes every fetch wait out the IPv6
// connect before trying IPv4 (two at once, one of them times out): this asks
// for IPv4 first, which the site serves anyway.
try {
  setDefaultResultOrder("ipv4first")
} catch {
  // an older Node without it still works, only slower
}

export const ORIGIN = () => String(process.env.YYDS_ORIGIN ?? "https://www.yydsapi.uno").replace(/\/+$/, "")
export const TZ = "Asia/Shanghai"
const PAGE_SIZE = 500
const MAX_PAGES = 40

export class SiteUsage {
  #fetch
  #origin

  constructor({ fetchImpl = globalThis.fetch, origin = ORIGIN() } = {}) {
    this.#fetch = fetchImpl
    this.#origin = origin.replace(/\/+$/, "")
  }

  async #data(path, token) {
    const res = await this.#ask(`${this.#origin}/api/v1${path}`, token)
    const text = await res.text()
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error(`只因API 返回了读不懂的答复（HTTP ${res.status}）`)
    }
    if (!res.ok || (payload?.code !== 0 && payload?.code !== "0")) {
      throw new Error(payload?.message || `只因API 拒绝了这次请求（HTTP ${res.status}）`)
    }
    return payload.data
  }

  /**
   * One request, tried again on what is the network's fault and not the
   * site's answer: a connect that times out, a reset, a 429 or a 5xx. The
   * site's edge does drop one now and then, and a page of the ledger is not
   * worth failing the whole page over.
   */
  async #ask(url, token) {
    let last
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 300 * 3 ** (attempt - 1)))
      let res
      try {
        res = await this.#fetch(url, {
          headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30_000),
        })
      } catch (error) {
        last = error
        continue
      }
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`只因API 暂时不可用（HTTP ${res.status}）`)
        continue
      }
      return res
    }
    throw last
  }

  /** The account: balance, what was ever paid in, and its name. */
  me(token) {
    return this.#data("/auth/me", token)
  }

  /**
   * Every request between two site days, oldest page first. A page the site
   * won't give after its retries ends the walk with what came before it: a
   * curve of the days it did answer beats no page at all, and `partial` says
   * so.
   */
  async requests(token, { from, to }) {
    const out = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const query = new URLSearchParams({
        start_date: from,
        end_date: to,
        page: String(page),
        page_size: String(PAGE_SIZE),
        timezone: TZ,
      })
      let data
      try {
        data = await this.#data(`/usage?${query}`, token)
      } catch (error) {
        if (page === 1) throw error
        out.partial = true
        break
      }
      const items = Array.isArray(data?.items) ? data.items : []
      out.push(...items.map(requestOf))
      const pages = Number(data?.pages) || 1
      if (page >= pages || items.length === 0) break
    }
    const sorted = out.sort((a, b) => a.at - b.at)
    if (out.partial) sorted.partial = true
    return sorted
  }
}

/** One ledger row, as the page needs it. */
export function requestOf(row) {
  return {
    at: Date.parse(row?.created_at) || 0,
    model: String(row?.model ?? ""),
    requests: 1,
    input: count(row?.input_tokens),
    output: count(row?.output_tokens),
    cache: count(row?.cache_read_tokens),
    tokens: count(row?.input_tokens) + count(row?.output_tokens) + count(row?.cache_read_tokens),
    cost: money(row?.actual_cost),
    listCost: money(row?.total_cost),
  }
}

/** A site day (`2026-11-18`) for a moment, in the site's zone. */
export function siteDay(at, zone = TZ) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at))
  } catch {
    return new Date(at).toISOString().slice(0, 10)
  }
}

/** `days` site days back from `now`, as `{from, to}`. */
export function range(days, now = new Date()) {
  const to = siteDay(now.getTime())
  const from = siteDay(now.getTime() - Math.max(1, days) * 86_400_000)
  return { from, to }
}

/**
 * The balance over time: today's balance, climbed by everything spent since.
 * Points are oldest first; `at` is when the balance was what `amount` says.
 */
export function balanceCurve(requests, { balanceNow = 0, now = Date.now(), max = 400 } = {}) {
  const sorted = [...requests].filter((r) => r.at > 0).sort((a, b) => a.at - b.at)
  const points = [{ at: now, amount: round2(balanceNow) }]
  let amount = balanceNow
  for (let i = sorted.length - 1; i >= 0; i--) {
    const request = sorted[i]
    if (request.cost <= 0) continue
    amount += request.cost
    points.push({ at: request.at, amount: round2(amount) })
  }
  points.reverse()
  return thin(points, max)
}

/** Daily spend and volume, oldest day first, gaps kept as zero days. */
export function dailySpend(requests, { from, to, zone = TZ }) {
  const byDay = new Map()
  for (const request of requests) {
    const day = siteDay(request.at, zone)
    const row = byDay.get(day) ?? { date: day, cost: 0, listCost: 0, requests: 0, tokens: 0 }
    row.cost += request.cost
    row.listCost += request.listCost
    row.requests += 1
    row.tokens += request.tokens
    byDay.set(day, row)
  }
  const out = []
  for (let day = from; day <= to; day = nextDay(day)) {
    const row = byDay.get(day) ?? { date: day, cost: 0, listCost: 0, requests: 0, tokens: 0 }
    out.push({ ...row, cost: round2(row.cost), listCost: round2(row.listCost) })
  }
  return out
}

/** The same requests by model, dearest first. */
export function byModel(requests) {
  const byName = new Map()
  for (const request of requests) {
    const row = byName.get(request.model) ?? { model: request.model, requests: 0, tokens: 0, cost: 0 }
    row.requests += 1
    row.tokens += request.tokens
    row.cost += request.cost
    byName.set(request.model, row)
  }
  return [...byName.values()].map((row) => ({ ...row, cost: round2(row.cost) })).sort((a, b) => b.cost - a.cost)
}

/** Everything the page shows, from the two reads it needs. */
export function summary({ me, requests, from, to, now = Date.now() }) {
  const balance = money(me?.balance)
  const recharged = money(me?.total_recharged)
  const spentInRange = requests.reduce((sum, r) => sum + r.cost, 0)
  const days = dailySpend(requests, { from, to })
  const today = days.find((day) => day.date === siteDay(now)) ?? { date: siteDay(now), cost: 0, requests: 0, tokens: 0 }
  return {
    user: String(me?.username ?? me?.email ?? ""),
    balance: round2(balance),
    frozen: round2(money(me?.frozen_balance)),
    recharged: round2(recharged),
    currency: "$",
    from,
    to,
    today,
    spent: round2(spentInRange),
    requests: requests.length,
    days,
    models: byModel(requests),
    curve: balanceCurve(requests, { balanceNow: balance, now }),
    recent: [...requests].reverse().slice(0, 40),
    partial: requests.partial === true,
    // what the arithmetic can't know: a top-up inside the window lifts the
    // balance without a request to explain it
    toppedUp: recharged > 0 && balance + spentInRange > recharged + 0.01,
  }
}

function nextDay(day) {
  const at = Date.parse(`${day}T00:00:00Z`) + 86_400_000
  return new Date(at).toISOString().slice(0, 10)
}

/** Keeps the shape but not every point: a curve is drawn, not listed. */
function thin(points, max) {
  if (points.length <= max) return points
  const step = points.length / max
  const out = []
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)])
  out.push(points[points.length - 1])
  return out
}

function count(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function money(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function round2(value) {
  return Math.round(value * 100) / 100
}
