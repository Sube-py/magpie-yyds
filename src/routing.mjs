// Which key answers a request.
//
// A key belongs to a group, and a group serves its own models. So the models
// of the account are the union of its keys' lists, and a model is asked of the
// first key that lists it — the order is the person's, so preference is theirs
// too. Nothing is guessed: a model no key lists is not offered at all.

import { READ_TTL_MS } from "./constants.mjs"

export class KeyRouter {
  #catalog
  #ttlMs
  #byKey = new Map()

  constructor({ catalog, ttlMs = READ_TTL_MS } = {}) {
    this.#catalog = catalog
    this.#ttlMs = ttlMs
  }

  /** Each key and the models its group serves, read at most once a minute. */
  async lists(keys, { fresh = false } = {}) {
    const out = []
    for (const entry of keys) {
      const kept = this.#byKey.get(entry.key)
      if (!fresh && kept && Date.now() - kept.at < this.#ttlMs) {
        out.push({ ...entry, models: kept.models })
        continue
      }
      try {
        const models = await this.#catalog.list(entry.key)
        this.#byKey.set(entry.key, { models, at: Date.now() })
        out.push({ ...entry, models })
      } catch {
        // a key the site won't answer for serves nothing this minute
        out.push({ ...entry, models: kept?.models ?? [] })
      }
    }
    return out
  }

  /** The model → key map, first key in the person's order winning. */
  async routes(keys) {
    const byModel = new Map()
    for (const entry of await this.lists(keys)) {
      for (const model of entry.models) {
        if (!byModel.has(model.id)) {
          byModel.set(model.id, { ...entry, name: model.name, ...(model.ownedBy ? { ownedBy: model.ownedBy } : {}) })
        }
      }
    }
    return byModel
  }

  /** The key a model is asked of, or null when no key serves it. */
  async keyFor(keys, model) {
    const [first] = await this.candidates(keys, model)
    return first ?? null
  }

  /** Every key that serves a model, in the person's order. */
  async candidates(keys, model) {
    const id = String(model ?? "").trim()
    if (!id) return []
    const out = []
    for (const entry of await this.lists(keys)) {
      if (entry.models.some((m) => m.id === id)) out.push(entry)
    }
    return out
  }

  /**
   * Every model the keys serve, in magpie's shape: `build` is given the model
   * and what is already known of that id (magpie's catalog entry), so the entry
   * this provider hands back keeps the capabilities and price magpie had rather
   * than starting from nothing.
   */
  async entries(providerId, keys, build, knownOf = () => undefined) {
    const byModel = await this.routes(keys)
    return Object.fromEntries(
      [...byModel].map(([id, entry]) => {
        const model = { id, name: entry.name, ...(entry.ownedBy ? { ownedBy: entry.ownedBy } : {}) }
        const meta = typeof knownOf === "function" ? knownOf(id, model.ownedBy) : knownOf?.[id]
        return [id, build(providerId, model, meta, model.ownedBy)]
      }),
    )
  }

  /** Forgets what a key said, so its list is read again. */
  forget(key) {
    this.#byKey.delete(String(key ?? ""))
  }
}
