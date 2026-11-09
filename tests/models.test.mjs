import assert from "node:assert/strict"
import test from "node:test"

import { runtimeModel } from "../src/models.mjs"
import { chatBase, NPM } from "../src/constants.mjs"

const known = {
  id: "gpt-6.1-sol",
  providerID: "catalog-vendor",
  name: "GPT-6.1 Sol (catalog)",
  api: { id: "gpt-6.1-sol", url: "https://vendor.example/v1", npm: "@ai-sdk/openai-compatible" },
  limit: { context: 1_000_000, output: 128_000 },
  cost: { input: 1.25, output: 10, cache: { read: 0.125, write: 0 } },
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: true,
    toolcall: true,
    input: { text: true, image: true, audio: false, video: false, pdf: false },
    output: { text: true, image: false, audio: false, video: false, pdf: false },
  },
  variants: ["low", "medium", "high", "xhigh"],
}

test("a model magpie knows keeps its image support, reasoning levels and price", () => {
  const model = runtimeModel("yyds", { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" }, known)
  assert.equal(model.id, "gpt-6.1-sol")
  assert.equal(model.providerID, "yyds")
  assert.equal(model.name, "GPT-6.1 Sol", "the site's display name")
  assert.deepEqual(model.api, { id: "gpt-6.1-sol", url: chatBase(), npm: NPM }, "this provider's address")
  assert.deepEqual(model.variants, ["low", "medium", "high", "xhigh"])
  assert.equal(model.capabilities.reasoning, true)
  assert.equal(model.capabilities.attachment, true)
  assert.equal(model.capabilities.input.image, true)
  assert.deepEqual(model.limit, { context: 1_000_000, output: 128_000 })
  assert.equal(model.cost.input, 1.25)
})

test("a model with no display name of its own is called what magpie calls it", () => {
  const model = runtimeModel("yyds", { id: "gpt-6.1-sol", name: "gpt-6.1-sol" }, known)
  assert.equal(model.name, "GPT-6.1 Sol (catalog)")
})

test("a model magpie knows gets the table's limits when the catalog has none", () => {
  const model = runtimeModel("yyds", { id: "glm-5.3", name: "GLM-5.3" }, { ...known, limit: { context: 0, output: 0 } })
  assert.deepEqual(model.limit, { context: 200_000, output: 64_000 })
})

test("an id nobody knows gets a plain text entry with no invented limits", () => {
  const model = runtimeModel("yyds", { id: "relay-only-1", name: "Relay Only" }, undefined)
  assert.equal(model.name, "Relay Only")
  assert.deepEqual(model.limit, { context: 0, output: 0 })
  assert.equal(model.capabilities.reasoning, false)
  assert.equal(model.capabilities.attachment, false)
  assert.deepEqual(model.variants, {})
  assert.deepEqual(model.cost, { input: 0, output: 0, cache: { read: 0, write: 0 } })
})
