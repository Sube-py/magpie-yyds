import assert from "node:assert/strict"
import test from "node:test"

import { YydsApi } from "../src/api.mjs"
import { ModelCatalog } from "../src/models.mjs"
import { KeyRouter } from "../src/routing.mjs"
import { makeFetch } from "./helpers.mjs"

const KEY_A = `sk-${"a".repeat(24)}`
const KEY_B = `sk-${"b".repeat(24)}`

/** A site whose model list depends on which key asked. */
function catalogFor(lists, { fail = [] } = {}) {
  const { fetchImpl, calls } = makeFetch((url, init) => {
    const key = String(init.headers.Authorization ?? "").replace("Bearer ", "")
    if (fail.includes(key)) return { status: 401, body: { error: { message: "invalid token" } } }
    const data = (lists[key] ?? []).map((id) => ({ id, display_name: id.toUpperCase() }))
    return { body: { data } }
  })
  return { router: new KeyRouter({ catalog: new ModelCatalog({ api: new YydsApi({ fetchImpl }) }) }), calls }
}

test("the account's models are the union of its keys' groups", async () => {
  const { router } = catalogFor({ [KEY_A]: ["gpt-6.1-sol", "shared"], [KEY_B]: ["glm-5.3", "shared"] })
  const byModel = await router.routes([
    { label: "GPT", key: KEY_A },
    { label: "Glm", key: KEY_B },
  ])
  assert.deepEqual([...byModel.keys()], ["gpt-6.1-sol", "shared", "glm-5.3"])
  assert.equal(byModel.get("shared").label, "GPT", "the first key of the person's list wins")
})

test("a model is asked of the key whose group lists it", async () => {
  const { router } = catalogFor({ [KEY_A]: ["gpt-6.1-sol"], [KEY_B]: ["glm-5.3"] })
  const keys = [
    { label: "GPT", key: KEY_A },
    { label: "Glm", key: KEY_B },
  ]
  assert.equal((await router.keyFor(keys, "glm-5.3")).key, KEY_B)
  assert.equal((await router.keyFor(keys, "gpt-6.1-sol")).key, KEY_A)
  assert.equal(await router.keyFor(keys, "not-served"), null)
})

test("every key that serves a model is a candidate, in order", async () => {
  const { router } = catalogFor({ [KEY_A]: ["shared"], [KEY_B]: ["shared"] })
  const candidates = await router.candidates(
    [
      { label: "one", key: KEY_A },
      { label: "two", key: KEY_B },
    ],
    "shared",
  )
  assert.deepEqual(candidates.map((c) => c.label), ["one", "two"])
})

test("a key the site refuses serves nothing, and doesn't hide the others", async () => {
  const { router } = catalogFor({ [KEY_A]: ["glm-5.3"], [KEY_B]: ["shared"] }, { fail: [KEY_A] })
  const keys = [
    { label: "broken", key: KEY_A },
    { label: "good", key: KEY_B },
  ]
  const byModel = await router.routes(keys)
  assert.deepEqual([...byModel.keys()], ["shared"])
  assert.equal((await router.keyFor(keys, "glm-5.3")), null)
})

test("lists are kept for a minute, and a refused key can be re-read", async () => {
  const { router, calls } = catalogFor({ [KEY_A]: ["glm-5.3"] })
  const keys = [{ label: "", key: KEY_A }]
  await router.lists(keys)
  await router.lists(keys)
  assert.equal(calls.length, 1)
  await router.lists(keys, { fresh: true })
  assert.equal(calls.length, 2)
  router.forget(KEY_A)
  await router.lists(keys)
  assert.equal(calls.length, 3)
})

test("an entry keeps what magpie knows of the id, and takes this provider's address", async () => {
  const { router } = catalogFor({ [KEY_A]: ["glm-5.3"] })
  const known = {
    "glm-5.3": {
      id: "glm-5.3",
      providerID: "somewhere-else",
      name: "GLM-5.3 (catalog)",
      api: { id: "glm-5.3", url: "https://vendor.example/v1", npm: "@ai-sdk/openai-compatible" },
      limit: { context: 1_000_000, output: 48_000 },
      cost: { input: 0.6, output: 2.2, cache: { read: 0.06, write: 0 } },
      capabilities: { temperature: true, reasoning: true, attachment: true, toolcall: true },
      variants: ["low", "high", "max"],
    },
  }
  const entries = await router.entries(
    "yyds",
    [{ label: "", key: KEY_A }],
    (providerId, m, entry) => ({ ...(entry ?? {}), id: m.id, providerID: providerId, name: m.name }),
    known,
  )
  const model = entries["glm-5.3"]
  assert.equal(model.providerID, "yyds", "this provider's id")
  assert.equal(model.name, "GLM-5.3", "the site's display name")
  assert.deepEqual(model.variants, ["low", "high", "max"], "the reasoning levels magpie knew")
  assert.equal(model.capabilities.reasoning, true)
  assert.equal(model.capabilities.attachment, true)
  assert.deepEqual(model.limit, { context: 1_000_000, output: 48_000 }, "magpie's limits, not ours")
  assert.equal(model.cost.input, 0.6)
})

test("an id magpie never heard of gets the small table, and no invented limits", async () => {
  const { router } = catalogFor({ [KEY_A]: ["glm-5.3", "relay-only-1"] })
  const entries = await router.entries("yyds", [{ label: "", key: KEY_A }], (id, m, entry) => ({ ...(entry ?? {}), id: m.id, name: m.name }), {})
  assert.equal(entries["relay-only-1"].limit, undefined, "nothing is made up")
  assert.equal(entries["glm-5.3"].limit, undefined, "and nothing is made up for a known id either")
})

test("the vendor the site names reaches whoever looks the model up", async () => {
  const { fetchImpl } = makeFetch(() => ({
    body: { data: [{ id: "grok-4.7", display_name: "Grok 4.7", owned_by: "xai" }] },
  }))
  const router = new KeyRouter({ catalog: new ModelCatalog({ api: new YydsApi({ fetchImpl }) }) })
  const asked = []
  await router.entries(
    "yyds",
    [{ label: "", key: KEY_A }],
    (providerId, model, meta) => ({ ...(meta ?? {}), id: model.id }),
    (id, ownedBy) => {
      asked.push([id, ownedBy])
      return undefined
    },
  )
  assert.deepEqual(asked, [["grok-4.7", "xai"]])
})
