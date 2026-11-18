// Where magpie keeps its own files, and the 只因API session this page reads.
//
// The page runs in a frame with no network of its own, so a small service this
// plugin starts does the reading (see index.mjs). It needs the account's
// session, which the provider plugin (`magpie-yyds`) already saved in
// `plugin-auth.json` — read here, never written.

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** magpie's own folder: what the app uses, and what a test can point elsewhere. */
export function configDir(env = process.env, home = homedir()) {
  const explicit = String(env.MAGPIE_CONFIG_DIR ?? "").trim()
  if (explicit) return explicit
  const xdg = String(env.XDG_CONFIG_HOME ?? "").trim()
  if (xdg) return join(xdg, "magpie")
  return join(home, ".config", "magpie")
}

/** The provider id the session is kept under, and the provider this page reads. */
export const PROVIDER_ID = "yyds"

/** The account's session token, or "" when nobody signed in. */
export function sessionToken(dir = configDir()) {
  try {
    const auth = JSON.parse(readFileSync(join(dir, "plugin-auth.json"), "utf8"))
    const record = auth?.[PROVIDER_ID]
    if (record?.type !== "oauth") return ""
    return typeof record.access === "string" ? record.access.trim() : ""
  } catch {
    return ""
  }
}

/** The account's own name, for the page's heading. */
export function accountName(dir = configDir()) {
  try {
    const auth = JSON.parse(readFileSync(join(dir, "plugin-auth.json"), "utf8"))
    const record = auth?.[PROVIDER_ID] ?? {}
    for (const value of [record.accountId, record.username, record.email]) {
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  } catch {}
  return ""
}
