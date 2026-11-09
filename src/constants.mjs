// What this plugin signs in to and how it talks to the site.
//
// 只因API is a relay on its own REST API (`/api/v1`, a JWT session) plus an
// OpenAI-compatible chat base (`/v1`, `sk-` keys). Both sit on the one
// origin, so an account's sign-in (for the check-in and the balance) and its
// requests are told apart by path only.

/** The account's provider: the check-in, the balance and the models. */
export const PROVIDER_ID = "yyds"
export const PROVIDER_NAME = "只因API"
export const NPM = "@ai-sdk/openai-compatible"

export const DEFAULT_ORIGIN = "https://www.yydsapi.uno"

/** The site's own host, overridable for a mirror or a test. */
export function origin() {
  const raw = String(process.env.YYDS_ORIGIN ?? "").trim() || DEFAULT_ORIGIN
  return raw.replace(/\/+$/, "")
}

/** The REST API a session signs in to: `/auth/login`, `/activity/checkin`, … */
export function apiBase() {
  return `${origin()}/api/v1`
}

/** The OpenAI-compatible base chats and the model list go to. */
export function chatBase() {
  return `${origin()}/v1`
}

/** magpie renews the sign-in this long before the access token ends. */
export const LEAD_MS = 5 * 60 * 1000

/** A token this close to its end is renewed before it is used. */
export const EARLY_MS = 60 * 1000

/** How long the balance and the key list are kept between reads. */
export const READ_TTL_MS = 60 * 1000

export const USER_AGENT = "magpie-yyds-auth/0.1.0"

/**
 * What is known of some of the site's models: `context` and `output`, which
 * `GET /v1/models` never tells. A model listed here gets these limits; any
 * other keeps none (magpie then falls back to its own knowledge of the id).
 * The table is not a model list: what is served is read from the keys.
 */
export const KNOWN_MODELS = [
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", context: 200_000, output: 64_000 },
  { id: "gpt-6-sol", name: "GPT-6 Sol", context: 200_000, output: 64_000 },
  { id: "gpt-6-astra", name: "GPT-6 Astra", context: 200_000, output: 64_000 },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", context: 200_000, output: 64_000 },
  { id: "grok-4.7", name: "Grok 4.7", context: 200_000, output: 64_000 },
  { id: "glm-5.3", name: "GLM-5.3", context: 200_000, output: 64_000 },
  { id: "deepseek-v4.1-flash-1017", name: "DeepSeek V4.1 Flash", context: 128_000, output: 32_000 },
]
