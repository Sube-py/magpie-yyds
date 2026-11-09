// Getting an account signed in.
//
// Three ways in, and what each one is for is the whole design:
//
//   * the account (email + password, or a session copied out of the browser)
//     is what 签到 and 余额 belong to — the site keeps both by account, not by
//     key. An account signed in this way serves no chats: its key list is not
//     read and no key is chosen for it;
//   * an `sk-` key is what chats belong to, and an account can hold several,
//     each in its own group (its own models, its own price). So keys are
//     added one by one, by the person, in the provider's editor — never
//     chosen by the plugin, and never asked for while signing in to the
//     account.

import { YydsError, signedOutError } from "./errors.mjs"
import { expiryOf, stripBearer } from "./jwt.mjs"
import { looksLikeKey } from "./key.mjs"

const CAPTCHA_FIELDS = [
  "turnstile_enabled",
  "tencent_captcha_enabled",
  "geetest_captcha_enabled",
  "aliyun_captcha_enabled",
]

export class SignInService {
  #api

  constructor({ api } = {}) {
    this.#api = api
  }

  /** The login page's own call: `POST /auth/login {email, password}`. */
  async password({ email, password } = {}) {
    const address = String(email ?? "").trim()
    const secret = String(password ?? "")
    if (!address || !secret) throw new YydsError("请填写只因API 的邮箱和密码", { status: 400 })
    if (await this.#captchaOnLogin()) {
      throw new YydsError("只因API 的登录开启了人机验证，请改用「粘贴浏览器会话」登录", { status: 400 })
    }
    const data = await this.#api.data("/auth/login", {
      method: "POST",
      body: { email: address, password: secret },
    })
    const access = stripBearer(data?.access_token)
    if (!access) throw new YydsError("只因API 没有给出 access token", { status: 502 })
    const expiresIn = Number(data?.expires_in)
    return this.complete({
      access,
      refresh: stripBearer(data?.refresh_token),
      expires: expiryOf(access) || (Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0),
    })
  }

  /** A session copied out of the browser, as JSON, a token, or key=value. */
  async paste({ session } = {}) {
    const raw = String(session ?? "").trim()
    if (!raw) throw new YydsError("请粘贴只因API 的 auth_token 或 refresh_token", { status: 400 })
    if (looksLikeKey(raw)) {
      throw new YydsError("这是 API 密钥，不是登录会话：请到「只因API 密钥」页面添加（用于对话，不参与签到）", { status: 400 })
    }
    const read = readSession(raw)
    let access = read.access
    let refresh = read.refresh
    let expires = expiryOf(access)
    if (access) {
      try {
        await this.#api.data("/auth/me", { token: access })
      } catch (error) {
        if (!refresh || !(error instanceof YydsError && error.signedOut)) throw error
        access = ""
      }
    }
    if (!access) {
      if (!refresh) throw new YydsError("没读到可用的只因API 会话，请重新复制", { status: 400 })
      const renewed = await this.#exchange(refresh)
      access = renewed.access
      refresh = renewed.refresh
      expires = renewed.expires
    }
    return this.complete({ access, refresh, expires })
  }

  /** The account's record, once its tokens are known to work. */
  async complete({ access, refresh = "", expires = 0 }) {
    const me = await this.#api.data("/auth/me", { token: access }).catch((error) => {
      if (error instanceof YydsError && error.signedOut) throw signedOutError("只因API 的会话不可用，请重新登录")
      throw error
    })
    const name = [me?.username, me?.email].find((v) => typeof v === "string" && v.trim())?.trim() ?? ""
    return {
      type: "success",
      accountId: name,
      ...(me?.id != null ? { uid: String(me.id) } : {}),
      ...(name ? { username: name } : {}),
      ...(typeof me?.email === "string" ? { email: me.email } : {}),
      access,
      ...(refresh ? { refresh } : {}),
      ...(expires > 0 ? { expires } : {}),
    }
  }

  async #exchange(refresh) {
    const data = await this.#api.data("/auth/refresh", { method: "POST", body: { refresh_token: refresh } })
    const access = stripBearer(data?.access_token)
    if (!access) throw signedOutError("只因API 没有给出新的 access token，请重新登录")
    const expiresIn = Number(data?.expires_in)
    return {
      access,
      refresh: stripBearer(data?.refresh_token) || refresh,
      expires: expiryOf(access) || (Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0),
    }
  }

  async #captchaOnLogin() {
    try {
      const settings = await this.#api.data("/settings/public")
      return CAPTCHA_FIELDS.some((field) => settings?.[field] === true)
    } catch {
      return false
    }
  }
}

/**
 * The tokens in what a person pasted: the site's localStorage JSON
 * (`auth_token`, `refresh_token`), any object naming either, a `key=value`
 * line, or a bare token.
 */
export function readSession(text) {
  const raw = String(text ?? "").trim()
  if (!raw) return { access: "", refresh: "" }
  if (raw.startsWith("{") || raw.startsWith("[")) {
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new YydsError("这段 JSON 读不懂，请只复制 auth_token 或 refresh_token", { status: 400 })
    }
    const flat = flatten(parsed)
    return {
      access: stripBearer(pick(flat, ["auth_token", "access_token", "accessToken", "access"])),
      refresh: stripBearer(pick(flat, ["refresh_token", "refreshToken", "refresh"])),
    }
  }
  const pair = /(?:^|[?&\s;,])(auth_token|access_token|refresh_token)=([^&\s;,]+)/.exec(raw)
  if (pair) {
    const token = stripBearer(pair[2])
    return pair[1] === "refresh_token" ? { access: "", refresh: token } : { access: token, refresh: "" }
  }
  const token = stripBearer(raw)
  if (!token) return { access: "", refresh: "" }
  return token.split(".").length >= 3 ? { access: token, refresh: "" } : { access: "", refresh: token }
}

function flatten(value, out = {}) {
  if (!value || typeof value !== "object") return out
  for (const [key, inner] of Object.entries(value)) {
    if (inner && typeof inner === "object" && !Array.isArray(inner)) flatten(inner, out)
    else if (typeof inner === "string") out[key] ??= inner
  }
  return out
}

function pick(flat, names) {
  for (const name of names) {
    const value = flat[name]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}
