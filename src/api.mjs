// The site's two APIs behind one client: the REST envelope under `/api/v1`
// and the OpenAI-compatible one under `/v1`.

import { YydsError } from "./errors.mjs"
import { USER_AGENT, apiBase, chatBase } from "./constants.mjs"

const DEFAULT_TIMEOUT_MS = 20_000

export class YydsApi {
  #fetch
  #timeoutMs

  constructor({ fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.#fetch = fetchImpl
    this.#timeoutMs = timeoutMs
  }

  /** One request, read as the site sent it: `{status, payload}`. */
  async send(url, { method = "GET", token, body, headers = {} } = {}) {
    const init = {
      method,
      redirect: "error",
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    }
    let res
    try {
      res = await this.#fetch(url, init)
    } catch (cause) {
      const why = cause?.name === "TimeoutError" ? "只因API 没有在时限内回答" : `连不上只因API（${cause?.message ?? cause}）`
      throw new YydsError(why, { status: 0 })
    }
    const text = await res.text()
    let payload = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        throw new YydsError(`只因API 返回了读不懂的答复（HTTP ${res.status}）`, { status: res.status })
      }
    }
    return { status: res.status, payload }
  }

  /**
   * A REST API call: its envelope is checked and its `data` given back.
   * `path` is under `/api/v1` (`/auth/me`).
   */
  async data(path, { method = "GET", token, body } = {}) {
    const { status, payload } = await this.send(`${apiBase()}${path}`, { method, token, body })
    const code = payload?.code
    const failed = status < 200 || status >= 300 || (code !== undefined && code !== 0 && code !== "0")
    if (failed) {
      const message = typeof payload?.message === "string" && payload.message.trim() ? payload.message.trim() : `只因API 拒绝了这次请求（HTTP ${status}）`
      throw new YydsError(message, {
        status,
        code: code === undefined ? "" : String(code),
        reason: typeof payload?.reason === "string" ? payload.reason : "",
      })
    }
    return payload?.data ?? null
  }

  /** A call under `/v1`: it carries no envelope, only its own JSON. */
  async openai(path, { method = "GET", key, body } = {}) {
    const { status, payload } = await this.send(`${chatBase()}${path}`, {
      method,
      token: key,
      body,
    })
    if (status < 200 || status >= 300) {
      const message =
        typeof payload?.error?.message === "string"
          ? payload.error.message
          : typeof payload?.message === "string" && payload.message.trim()
            ? payload.message
            : `只因API 拒绝了这次请求（HTTP ${status}）`
      throw new YydsError(message, { status })
    }
    return payload
  }
}
