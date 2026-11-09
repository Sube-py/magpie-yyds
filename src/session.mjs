// Keeping an account's access token usable.
//
// The site trades a `refresh_token` for a new pair. A refresh token is spent
// when it is used, so one renewal at a time per token, and what it gave is
// kept for a minute: two hooks asking at once (the models list, a request)
// must not spend it twice.

import { YydsError, signedOutError } from "./errors.mjs"
import { EARLY_MS } from "./constants.mjs"
import { expiryOf, isStale, stripBearer } from "./jwt.mjs"

const KEEP_RENEWED_MS = 60_000

export class SessionKeeper {
  #api
  #save
  #renewing = new Map()
  #renewed = new Map()

  /** `save(record)` writes a renewed record back to the account, if it can. */
  constructor({ api, save } = {}) {
    this.#api = api
    this.#save = save
  }

  /**
   * The account's tokens, renewed first when they are due (or when `force`
   * asks after the site refused them). `{record, renewed}` comes back; a
   * sign-in that can't be renewed throws a `signedOut` error.
   */
  async current(record, { force = false, earlyMs = EARLY_MS } = {}) {
    let kept = this.#latest(record)
    if (kept.refresh && !force && !isStale(kept, earlyMs)) {
      await this.#persist(record, kept)
      return { record: kept, renewed: kept.access !== record?.access }
    }
    if (!kept.refresh) {
      if (!force && kept.access && !isStale(kept, earlyMs)) return { record: kept, renewed: false }
      throw signedOutError("只因API 的登录已过期且没有 refresh token，请重新登录")
    }
    const next = await this.#renew(kept)
    await this.#persist(record, next)
    return { record: next, renewed: true }
  }

  /** A renewal the caller asked for itself, without a record to compare to. */
  async renew(record) {
    const next = await this.#renew(this.#latest(record))
    await this.#persist(record, next)
    return next
  }

  /** The newest tokens this process knows for the account. */
  #latest(record) {
    let kept = { ...record }
    for (let hop = 0; hop < 8 && kept.refresh; hop++) {
      const done = this.#renewed.get(kept.refresh)
      if (!done || Date.now() - done.at >= KEEP_RENEWED_MS) break
      kept = { ...kept, ...done.next }
    }
    if (!kept.expires && kept.access) kept.expires = expiryOf(kept.access)
    return kept
  }

  async #renew(record) {
    const key = String(record?.refresh ?? "")
    if (!key) throw signedOutError("只因API 的登录已过期，请重新登录")
    let running = this.#renewing.get(key)
    if (!running) {
      running = this.#exchange(key)
        .then((next) => {
          this.#renewed.set(key, { next, at: Date.now() })
          return next
        })
        .finally(() => this.#renewing.delete(key))
      this.#renewing.set(key, running)
    }
    const next = await running
    return { ...record, ...next }
  }

  async #exchange(refresh) {
    let data
    try {
      data = await this.#api.data("/auth/refresh", { method: "POST", body: { refresh_token: refresh } })
    } catch (error) {
      if (error instanceof YydsError && error.signedOut) {
        throw signedOutError("只因API 的登录已失效，请重新登录")
      }
      throw error
    }
    const access = stripBearer(data?.access_token)
    if (!access) throw signedOutError("只因API 没有给出新的 access token，请重新登录")
    const expiresIn = Number(data?.expires_in)
    return {
      access,
      refresh: stripBearer(data?.refresh_token) || refresh,
      expires: expiryOf(access) || (Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0),
    }
  }

  async #persist(before, after) {
    if (!this.#save || !after?.access) return
    if (before?.access === after.access && before?.refresh === after.refresh && before?.expires === after.expires) return
    try {
      await this.#save(after)
    } catch {
      // a hook that can't write the account keeps the tokens in memory
    }
  }
}

/**
 * Runs a read with the account's tokens, renewing them once when the site
 * refuses them and the account can be renewed. A read that fails for any
 * other reason is thrown as it came.
 */
export async function withRenewal(session, record, run) {
  try {
    return await run(record)
  } catch (error) {
    if (!error?.signedOut || !record?.refresh) throw error
    const renewed = await session.renew(record)
    return run(renewed)
  }
}
