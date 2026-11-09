// What magpie (and OpenCode 1.x) loads.
//
// One provider, one account, and the account's keys one level below it:
//
//   只因API 账号 (sube)          ← the session: 每日签到 + 余额
//     ├─ 密钥 GPT 稳定分组        ← settings, not accounts
//     ├─ 密钥 Glm
//     └─ 模型 = 这些密钥分组的并集
//
// The site refuses `sk-` keys on the session endpoints (`INVALID_TOKEN`), so
// the check-in can't be done with a key; and a chat can't be done with a
// session, because a key is what a chat is billed to. magpie's plugin
// providers have no place under an account for a key list (accounts are
// sign-ins, one level), so the keys are the plugin's own settings —
// `magpie.options` — and this provider serves every model they offer.

import {
  KNOWN_MODELS,
  LEAD_MS,
  NPM,
  PROVIDER_ID,
  PROVIDER_NAME,
  chatBase,
} from "./constants.mjs"
import { YydsApi } from "./api.mjs"
import { KEYS_EXAMPLE, keysOf } from "./keystore.mjs"
import { ModelCatalog, runtimeModel } from "./models.mjs"
import { ModelsDevCatalog } from "./catalog.mjs"
import { KeyRouter } from "./routing.mjs"
import { SessionKeeper, withRenewal } from "./session.mjs"
import { UsageReporter } from "./usage.mjs"
import { CheckinService } from "./checkin.mjs"
import { routedLoader } from "./loader.mjs"
import { SignInService } from "./signin.mjs"

/**
 * @param {{ client?: { auth?: { set?: (opts: unknown) => Promise<unknown> } } }} input
 * @param {{ keys?: Array<{ label?: string, key: string }> }} options the plugin's settings
 */
export async function YydsAuthPlugin(input = {}, options = {}) {
  const client = input?.client
  const api = new YydsApi()
  const saveAuth = async (record) => {
    await client?.auth?.set?.({ path: { id: PROVIDER_ID }, body: record })
  }
  const session = new SessionKeeper({ api, save: saveAuth })
  const catalog = new ModelCatalog({ api })
  const known = new ModelsDevCatalog()
  const router = new KeyRouter({ catalog })
  const usage = new UsageReporter({ api })
  const checkins = new CheckinService({ api })
  const signin = new SignInService({ api })
  const keys = keysOf(options)

  return {
    config: async (config) => {
      config.provider ??= {}
      const was = config.provider[PROVIDER_ID] ?? {}
      config.provider[PROVIDER_ID] = {
        name: PROVIDER_NAME,
        npm: NPM,
        api: chatBase(),
        ...was,
        // the models are read from the account's keys; until then, none are
        // offered rather than models no key may serve
        models: {},
      }
    },

    provider: {
      id: PROVIDER_ID,
      async models(provider, { auth } = {}) {
        if (!keys.length) return provider.models
        try {
          // what magpie handed the hook first (its own entry for the provider),
          // then its catalog by id: the site's list carries no capabilities
          const listed = await router.entries(
            PROVIDER_ID,
            keys,
            runtimeModel,
            (id, ownedBy) => provider.models?.[id] ?? known.meta(id, ownedBy),
          )
          if (Object.keys(listed).length) return listed
          // keys are configured but none of them answered: say so instead of
          // showing no models and no reason
          throw new Error(STALE_KEYS)
        } catch (error) {
          if (error?.message === STALE_KEYS) throw error
          // the site being away is no reason to drop the list magpie had
          return provider.models
        }
      },
    },

    auth: {
      provider: PROVIDER_ID,
      refreshLead: LEAD_MS,
      methods: signInMethods(signin),
      loader: keys.length ? routedLoader({ router, keys }) : undefined,

      async refresh(auth) {
        if (auth?.type !== "oauth" || !auth.access || !auth.refresh) return undefined
        try {
          const { record } = await session.current(auth, { force: true })
          return fieldsOf(record)
        } catch (error) {
          if (error?.signedOut) error.signIn = "expired"
          throw error
        }
      },

      async usage(getAuth) {
        const auth = await getAuth()
        if (auth?.type !== "oauth" || !auth.access) return { error: "还没登录只因API" }
        try {
          const { record, renewed } = await session.current(auth)
          return await withRenewal(session, record, (current) => usage.report(current, { renewed }))
        } catch (error) {
          return { error: error?.message ?? String(error), signIn: error?.signedOut ? "expired" : "kept" }
        }
      },

      async checkin(getAuth) {
        const auth = await getAuth()
        if (auth?.type !== "oauth" || !auth.access) {
          return { outcome: "failed", message: "还没登录只因API" }
        }
        try {
          const { record } = await session.current(auth)
          return await withRenewal(session, record, (current) => checkins.run(current))
        } catch (error) {
          // no answer at all is the site being away: magpie asks again in a minute
          if (error?.status === 0) throw error
          return { outcome: "failed", message: error?.message ?? String(error) }
        }
      },
    },
  }
}

function signInMethods(signin) {
  return [
    {
      type: "oauth",
      label: "只因API 账号（邮箱 + 密码）",
      prompts: [
        {
          type: "input",
          key: "email",
          message: "只因API 账号邮箱",
          placeholder: "you@example.com",
          validate: (value) => (String(value ?? "").trim() ? undefined : "请填写邮箱"),
        },
        {
          type: "password",
          key: "password",
          message: "只因API 密码（只在这次登录时使用，不会保存）",
          validate: (value) => (String(value ?? "").trim() ? undefined : "请填写密码"),
        },
      ],
      authorize(inputs) {
        return autoFlow("正在登录只因API…", () => signin.password(inputs ?? {}))
      },
    },
    {
      type: "oauth",
      label: "只因API 账号（粘贴浏览器会话）",
      prompts: [
        {
          type: "text",
          key: "session",
          message: "在只因API 网站登录后，按 F12 → Application → Local Storage 复制 auth_token（或整段 JSON / refresh_token）",
          placeholder: "eyJhbGciOi…",
          validate: (value) => (String(value ?? "").trim() ? undefined : "请粘贴会话"),
        },
      ],
      authorize(inputs) {
        return autoFlow("正在验证只因API 会话…", () => signin.paste(inputs ?? {}))
      },
    },
  ]
}

const STALE_KEYS = "账号下的密钥均未能读取模型：请在「只因API 密钥」页面检查密钥与其所属分组"

/** A sign-in that finishes by itself, as a flow magpie can wait on. */
function autoFlow(instructions, run) {
  return {
    url: "",
    instructions,
    method: "auto",
    async callback() {
      try {
        return await run()
      } catch (error) {
        return { type: "failed", error: whyOf(error) }
      }
    },
  }
}

function whyOf(error) {
  const text = String(error?.message ?? error ?? "").trim() || "登录失败"
  return text.slice(0, 300)
}

/** The record's fields as magpie saves a renewal. */
function fieldsOf(record) {
  return {
    ...(record.accountId ? { accountId: record.accountId } : {}),
    ...(record.uid ? { uid: record.uid } : {}),
    ...(record.username ? { username: record.username } : {}),
    ...(record.email ? { email: record.email } : {}),
    access: record.access,
    ...(record.refresh ? { refresh: record.refresh } : {}),
    ...(record.expires ? { expires: record.expires } : {}),
  }
}

export const _internal = { KNOWN_MODELS, KEYS_EXAMPLE, fieldsOf, autoFlow, whyOf, signInMethods }
