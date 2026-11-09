import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { ModelsDevCatalog, catalogPath, entryOf } from "../src/catalog.mjs"

const fixture = {
  openai: {
    models: {
      "gpt-6.1-sol": {
        id: "gpt-6.1-sol",
        name: "GPT-6.1 Sol",
        reasoning: true,
        attachment: true,
        tool_call: true,
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        limit: { context: 1_050_000, input: 922_000, output: 128_000 },
        cost: { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 },
      },
    },
  },
  xai: {
    models: {
      "grok-4.7": {
        id: "grok-4.7",
        name: "Grok 4.7",
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 500_000, output: 128_000 },
        cost: { input: 1.9, output: 9.5 },
      },
    },
  },
  zai: {
    models: {
      "glm-5.3": {
        id: "glm-5.3",
        name: "GLM-5.3",
        reasoning: true,
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 1_000_000, output: 131_072 },
        cost: { input: 1.4, output: 5 },
      },
    },
  },
  "some-relay": {
    models: {
      "gpt-6.1-sol": { id: "gpt-6.1-sol", name: "GPT-6.1 Sol (relay copy)", limit: { context: 200_000, output: 64_000 } },
    },
  },
}

function withCatalog(data, run) {
  const dir = mkdtempSync(join(tmpdir(), "yyds-catalog-"))
  const file = join(dir, "models.json")
  writeFileSync(file, JSON.stringify(data))
  try {
    return run(new ModelsDevCatalog({ path: file }), file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("a model's capabilities and price come from magpie's catalog", () =>
  withCatalog(fixture, (catalog) => {
    const meta = catalog.meta("gpt-6.1-sol")
    assert.equal(meta.name, "GPT-6.1 Sol")
    assert.equal(meta.capabilities.reasoning, true)
    assert.equal(meta.capabilities.attachment, true)
    assert.equal(meta.capabilities.input.image, true)
    assert.equal(meta.capabilities.input.pdf, true)
    assert.deepEqual(meta.limit, { context: 1_050_000, input: 922_000, output: 128_000 })
    assert.deepEqual(meta.cost, { input: 2, output: 10, cache: { read: 0.1, write: 2.5 } })
  }))

test("the trusted vendor wins over a relay's copy of the same id", () =>
  withCatalog(fixture, (catalog) => {
    assert.equal(catalog.meta("gpt-6.1-sol").name, "GPT-6.1 Sol", "openai, not some-relay")
  }))

test("the vendor the site names is preferred when the catalog knows it", () =>
  withCatalog(fixture, (catalog) => {
    assert.equal(catalog.meta("grok-4.7", "xai").name, "Grok 4.7")
    assert.equal(catalog.meta("grok-4.7", "grok").name, "Grok 4.7", "a relay's word for xai")
    assert.equal(catalog.meta("glm-5.3", "zhipu").cost.input, 1.4, "zhipu is zai")
  }))

test("an id nobody knows is unknown, not invented", () =>
  withCatalog(fixture, (catalog) => {
    assert.equal(catalog.meta("relay-only-1"), undefined)
    assert.equal(catalog.meta(""), undefined)
  }))

test("no catalog file, or a broken one, is unknown rather than an error", () => {
  const dir = mkdtempSync(join(tmpdir(), "yyds-catalog-"))
  try {
    assert.equal(new ModelsDevCatalog({ path: join(dir, "missing.json") }).meta("glm-5.3"), undefined)
    const broken = join(dir, "broken.json")
    writeFileSync(broken, "{ not json")
    assert.equal(new ModelsDevCatalog({ path: broken }).meta("glm-5.3"), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("the catalog is read once, then again only when the file changes", () =>
  withCatalog(fixture, (catalog, file) => {
    assert.equal(catalog.meta("glm-5.3").name, "GLM-5.3")
    writeFileSync(file, JSON.stringify({ zai: { models: { "glm-5.3": { id: "glm-5.3", name: "GLM-5.3 (new)" } } } }))
    assert.equal(catalog.meta("glm-5.3").name, "GLM-5.3 (new)", "a changed file is read again")
  }))

test("where the catalog is: the override, then the cache the app uses", () => {
  assert.equal(catalogPath({ MAGPIE_MODELS_JSON: "/tmp/x.json" }, "/home/u"), "/tmp/x.json")
  assert.equal(catalogPath({ XDG_CACHE_HOME: "/c" }, "/home/u"), "/c/magpie/models.json")
  assert.equal(catalogPath({}, "/home/u"), "/home/u/.cache/magpie/models.json")
})

test("models.dev's entry converts to magpie's own shape", () => {
  const entry = entryOf({ id: "m", name: "M", reasoning: true, modalities: { input: ["text", "audio"] }, limit: { context: 1 } })
  assert.equal(entry.capabilities.reasoning, true)
  assert.equal(entry.capabilities.input.text, true)
  assert.equal(entry.capabilities.input.audio, true)
  assert.equal(entry.capabilities.input.image, false)
  assert.equal(entry.limit.context, 1)
  assert.equal(entry.limit.output, 0)
  assert.deepEqual(entry.variants, {})
})
