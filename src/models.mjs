// The models a key is served, and how magpie is told about them.
//
// `GET /v1/models` answers a list per key — an id and a display name, nothing
// more. Everything else magpie already knows about a model id (whether it
// takes images, which reasoning efforts it has, its context, its price) comes
// from its own catalog, and the hook is handed that entry in `provider.models`:
// so an entry is that entry with this provider's id, name and address, never a
// blank one built here. Only an id magpie has never heard of gets the small
// table below, and an id in neither gets no limits at all rather than a guess.

import { KNOWN_MODELS, NPM, chatBase } from "./constants.mjs"

const KNOWN = new Map(KNOWN_MODELS.map((m) => [m.id, m]))

export class ModelCatalog {
  #api

  constructor({ api } = {}) {
    this.#api = api
  }

  /** The ids the key may ask for, as `{id, name}`, newest list first. */
  async list(key) {
    const payload = await this.#api.openai("/models", { key })
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : []
    const out = []
    const seen = new Set()
    for (const row of rows) {
      const id = typeof row?.id === "string" ? row.id.trim() : ""
      if (!id || seen.has(id)) continue
      seen.add(id)
      const name = typeof row?.display_name === "string" && row.display_name.trim() ? row.display_name.trim() : id
      out.push({ id, name, ...(typeof row?.owned_by === "string" && row.owned_by.trim() ? { ownedBy: row.owned_by.trim() } : {}) })
    }
    return out
  }
}

/**
 * A listed model as this provider's entry: what is known of the id (magpie's
 * catalog, or the entry magpie handed the hook), with the id, provider, name
 * and address of this one.
 */
export function runtimeModel(providerId, m, known) {
  const api = { id: m.id, url: chatBase(), npm: NPM }
  const name = m.name && m.name !== m.id ? m.name : (known?.name ?? m.name)
  const limit = limitsOf(m.id, known)
  if (known && typeof known === "object") {
    return { ...known, id: m.id, providerID: providerId, name, api, limit }
  }
  return {
    id: m.id,
    providerID: providerId,
    name,
    api,
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, image: false, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: {},
    free: false,
  }
}

/** Context and output: magpie's when it says them, else the table, else none. */
function limitsOf(id, known) {
  const theirs = known?.limit
  if (theirs && (Number(theirs.context) > 0 || Number(theirs.output) > 0)) {
    return { context: Number(theirs.context) || 0, output: Number(theirs.output) || 0 }
  }
  const ours = KNOWN.get(id)
  return ours ? { context: ours.context, output: ours.output } : { context: 0, output: 0 }
}
