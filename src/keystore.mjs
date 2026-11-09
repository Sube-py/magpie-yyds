// The account's own keys, kept as plugin settings.
//
// They are not magpie accounts: an account is a credential magpie may route
// to, and these are one account's keys — one level down. So they live where a
// plugin's own settings live, `magpie.options` in plugins.json, edited in
// magpie under **Plugins → Installed → Options** (or `magpie plugin options`):
//
//   {"keys": [
//     {"label": "GPT 稳定分组", "key": "sk-…"},
//     {"label": "Glm", "key": "sk-…"}
//   ]}
//
// The order is the preference: a model several keys serve is asked of the
// first of them that lists it.

import { looksLikeKey } from "./key.mjs"

export const KEYS_OPTION = "keys"

/**
 * The keys as they were configured: `[{label, key}]`, in the order given,
 * with anything that isn't a key left out. A plain string is a key with no
 * label, so `{"keys": ["sk-…"]}` works too.
 */
export function keysOf(options) {
  const raw = options?.[KEYS_OPTION]
  const list = Array.isArray(raw) ? raw : []
  const out = []
  const seen = new Set()
  for (const entry of list) {
    const key = typeof entry === "string" ? entry : entry?.key
    const value = String(key ?? "").trim()
    if (!looksLikeKey(value) || seen.has(value)) continue
    seen.add(value)
    const said = typeof entry === "object" && entry !== null ? entry.label : ""
    out.push({ label: (typeof said === "string" ? said : "").trim().slice(0, 60), key: value })
  }
  return out
}

/** The example magpie offers when none are set, and shows in the editor. */
export const KEYS_EXAMPLE = { keys: [{ label: "GPT 稳定分组", key: "sk-REPLACE-WITH-YOUR-KEY" }] }
