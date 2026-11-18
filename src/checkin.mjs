// The daily check-in (每日签到).
//
// `/activity/checkin` reads as `{enabled, checked_in, amount, min_amount,
// max_amount, streak, continuous_streak, next_at, paid, locked,
// frozen_amount, today_frozen, limit_reached}`. Asking it again (POST) is the
// claim: a day already in answers the same record with `code: 0`, so the day
// is decided from the read before the claim, never from the claim's silence.
//
// A day the site guards with a captcha (Geetest here) can't be claimed by
// this plugin: the answer says so, and magpie then tells the person to check
// in in the site's own app. The claim is still *tried* first — the site's
// switch and the site's enforcement need not agree, so what the site answers
// decides, not a settings flag read beforehand.
//
// What each answer means for magpie:
//   claimed    the claim went through, with the amount it gave
//   done       today is already in (amount is what today gave)
//   inactive   the site has the check-in switched off
//   ineligible the account can't take part (locked, no credits to unlock it)
//   captcha    the site wants a captcha, which this plugin never solves
//   failed     anything else, with what the site said

import { YydsError } from "./errors.mjs"

const ALREADY_IN = /已签到|已领取|already\s+(checked|claimed)/i
const CAPTCHA = /captcha/i

export class CheckinService {
  #api

  constructor({ api } = {}) {
    this.#api = api
  }

  /** Today's record as the site keeps it. */
  status(token) {
    return this.#api.data("/activity/checkin", { token })
  }

  /** Claims today, with the captcha proof when the site wants one. */
  claim(token, proof) {
    return this.#api.data("/activity/checkin", {
      method: "POST",
      token,
      ...(proof ? { body: { proof } } : {}),
    })
  }

  /**
   * One check-in, from the read to the claim. `proof` is a captcha token a
   * person solved; without one a captcha-guarded site is left to its app.
   */
  async run(record, { proof = "" } = {}) {
    const token = record?.access
    if (!token) return { outcome: "failed", message: "还没登录只因API" }
    try {
      const status = await this.status(token)
      const decided = decide(status)
      if (decided) return decided
      // no pre-judging: the site answers, and a captcha it demands is its
      // answer (a proof may be handed in by a caller that solved one)
      return claimed(await this.claim(token, proof))
    } catch (error) {
      return failed(error)
    }
  }
}

/** The day as the read alone settles it, or null when it must be claimed. */
export function decide(status) {
  if (!status || status.enabled !== true) {
    return { outcome: "inactive", message: "只因API 现在没有开启每日签到" }
  }
  if (status.checked_in === true) {
    const credit = money(status.today_frozen ? 0 : status.amount)
    const streak = streakOf(status)
    const frozen = status.today_frozen === true
    return {
      outcome: "done",
      ...(credit > 0 ? { credit } : {}),
      ...(streak > 0 ? { streak } : {}),
      message: frozen
        ? `今日已签到，奖励冻结中（累计 $${money(status.frozen_amount).toFixed(3)}，充值后解锁）`
        : "今日已签到",
      ...untilOf(status),
    }
  }
  if (status.locked === true) {
    return {
      outcome: "ineligible",
      message: "只因API 的签到已锁定，请在网站上解锁后再试",
      ...untilOf(status),
    }
  }
  return null
}

/** The claim's own record, as today's check-in. */
export function claimed(data) {
  const credit = money(data?.today_frozen ? 0 : data?.amount)
  const streak = streakOf(data)
  const frozen = data?.today_frozen === true
  return {
    outcome: "claimed",
    ...(credit > 0 ? { credit } : {}),
    ...(streak > 0 ? { streak } : {}),
    message: frozen ? "签到成功，奖励冻结中（充值后解锁）" : "签到成功",
    ...untilOf(data),
  }
}

/** Whatever went wrong, as the day's failure rather than a silent success. */
export function failed(error) {
  if (error instanceof YydsError) {
    // no answer at all is the site being away: magpie asks again in a minute
    if (error.status === 0) throw error
    if (error.signedOut) return { outcome: "failed", message: "只因API 的登录已失效，请重新登录" }
    if (ALREADY_IN.test(error.message)) return { outcome: "done", message: error.message }
    if (CAPTCHA.test(`${error.message} ${error.reason} ${error.code}`)) {
      return {
        outcome: "captcha",
        message: "只因API 的签到要人机验证（Geetest），插件不代答：请到 yydsapi.uno 手动签到一次",
      }
    }
    return { outcome: "failed", message: error.message }
  }
  return { outcome: "failed", message: String(error?.message ?? error) }
}

/** When the site's own day turns, if the record says. */
function untilOf(status) {
  const raw = status?.next_at
  const at = typeof raw === "string" ? Date.parse(raw) : Number(raw)
  return Number.isFinite(at) && at > 0 ? { until: new Date(at).toISOString() } : {}
}

function streakOf(status) {
  const n = Number(status?.continuous_streak ?? status?.streak)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function money(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}
