// What magpie's catalog knows of a model id.
//
// The site's `GET /v1/models` answers an id and a display name and nothing
// else, while magpie knows more of the ids it has seen: whether a model takes
// images, whether it reasons, its context and its price. That knowledge lives
// in magpie's own copy of models.dev (`<cache>/magpie/models.json`), the same
// file a custom provider on this machine is filled from — so a plugin that
// hands back a bare entry would *drop* it (the plugin's list replaces what
// magpie had, id by id). Hence this read: the entries are made from it.
//
// An id it doesn't know stays bare, and nothing is invented for it.

import { readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const READ_TTL_MS = 60_000

/** Vendors to trust first, and the words a relay's `owned_by` uses for them. */
const PREFERRED = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "deepseek",
  "zai",
  "zhipuai",
  "moonshotai",
  "alibaba",
  "minimax",
  "meta",
  "mistral",
  "openrouter",
]

const OWNED = new Map([
  ["openai", "openai"],
  ["azure", "openai"],
  ["azure-openai", "openai"],
  ["anthropic", "anthropic"],
  ["claude", "anthropic"],
  ["google", "google"],
  ["gemini", "google"],
  ["xai", "xai"],
  ["x-ai", "xai"],
  ["grok", "xai"],
  ["deepseek", "deepseek"],
  ["zhipu", "zai"],
  ["z-ai", "zai"],
  ["zhipuai", "zai"],
  ["glm", "zai"],
  ["moonshot", "moonshotai"],
  ["moonshotai", "moonshotai"],
  ["kimi", "moonshotai"],
  ["alibaba", "alibaba"],
  ["qwen", "alibaba"],
  ["minimax", "minimax"],
  ["meta", "meta"],
  ["llama", "meta"],
  ["mistral", "mistral"],
])

/** Where magpie keeps its copy of models.dev. */
export function catalogPath(env = process.env, home = homedir()) {
  const explicit = String(env.MAGPIE_MODELS_JSON ?? "").trim()
  if (explicit) return explicit
  const cache = String(env.XDG_CACHE_HOME ?? "").trim()
  const roots = cache
    ? [join(cache, "magpie")]
    : [join(home, ".cache", "magpie"), join(home, "Library", "Caches", "magpie")]
  const files = roots.map((root) => join(root, "models.json"))
  return files.find(isFile) ?? files[0]
}

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export class ModelsDevCatalog {
  #path
  #read = { at: 0, mtime: 0, data: null }

  constructor({ path = catalogPath() } = {}) {
    this.#path = path
  }

  get path() {
    return this.#path
  }

  /** The catalog, read again only when the file has changed (or a minute passed). */
  #vendors() {
    let mtime = 0
    try {
      mtime = statSync(this.#path).mtimeMs
    } catch {
      return null
    }
    const fresh = this.#read.data && this.#read.mtime === mtime && Date.now() - this.#read.at < READ_TTL_MS
    if (fresh) return this.#read.data
    try {
      const data = JSON.parse(readFileSync(this.#path, "utf8"))
      this.#read = { at: Date.now(), mtime, data: data && typeof data === "object" ? data : null }
      return this.#read.data
    } catch {
      // a catalog mid-write is no catalog: the next call reads it again
      return this.#read.data
    }
  }

  /** The vendors that know this id, the hinted one first, then the trusted. */
  #vendorsFor(id, ownedBy) {
    const vendors = this.#vendors()
    if (!vendors) return []
    const has = (vendor) => Boolean(vendors?.[vendor]?.models?.[id])
    const hint = OWNED.get(String(ownedBy ?? "").trim().toLowerCase())
    const first = [hint, ...PREFERRED].filter((vendor, index, all) => vendor && has(vendor) && all.indexOf(vendor) === index)
    const rest = Object.keys(vendors).filter((vendor) => has(vendor) && !first.includes(vendor))
    return [...first, ...rest].map((vendor) => vendors[vendor].models[id])
  }

  /** What the catalog says of this id, as magpie's own model entry. */
  meta(id, ownedBy) {
    const [model] = this.#vendorsFor(String(id ?? "").trim(), ownedBy)
    return model ? entryOf(model) : undefined
  }
}

/** models.dev's entry as magpie builds it (see host.js `fromModelsDev`). */
export function entryOf(model) {
  return {
    name: model.name ?? model.id,
    status: model.status ?? "active",
    headers: {},
    options: {},
    cost: costOf(model.cost),
    limit: { context: number(model.limit?.context), input: number(model.limit?.input), output: number(model.limit?.output) },
    ...(model.temperature !== undefined ? { temperature: model.temperature } : {}),
    capabilities: {
      temperature: model.temperature ?? false,
      reasoning: model.reasoning ?? false,
      attachment: model.attachment ?? false,
      toolcall: model.tool_call ?? true,
      input: { ...modalitiesOf(model.modalities?.input), text: true },
      output: modalitiesOf(model.modalities?.output),
      interleaved: model.interleaved ?? false,
    },
    release_date: model.release_date ?? "",
    variants: {},
  }
}

function costOf(cost) {
  return {
    input: number(cost?.input),
    output: number(cost?.output),
    cache: { read: number(cost?.cache_read), write: number(cost?.cache_write) },
  }
}

function modalitiesOf(list) {
  const has = new Set(Array.isArray(list) ? list : [])
  return {
    text: has.has("text"),
    image: has.has("image"),
    audio: has.has("audio"),
    video: has.has("video"),
    pdf: has.has("pdf"),
  }
}

function number(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}
