// page/app.js, run against the DOM in dom.mjs: the save's three states and
// what an edit does to them. The page is not in a browser here, but it is the
// page's own code, events and all.

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import { makePage, rowTemplate } from "./dom.mjs"

const dir = join(import.meta.dirname, "..")
const source = readFileSync(join(dir, "page/app.js"), "utf8")
const keysSource = readFileSync(join(dir, "page/keys.js"), "utf8")
const html = readFileSync(join(dir, "page/index.html"), "utf8")

const KEY = `sk-${"a".repeat(24)}`

const page = (options = {}, { failSet = false } = {}) => {
  const store = { value: { ...options } }
  const pageDom = makePage({
    row: rowTemplate(),
    ids: ["add", "rows", "empty", "problems", "save", "state", "row"],
  })
  const magpie = {
    ready: Promise.resolve({ lang: "zh" }),
    options: {
      get: async () => ({ ...store.value }),
      set: async (next) => {
        if (failSet) throw new Error("bridge refused")
        store.value = { ...next }
        return { ...next }
      },
    },
  }
  const scope = {}
  new Function("globalThis", keysSource)(scope)
  const start = source.indexOf("(async () => {")
  const body = source.slice(start)
  const run = new Function("document", "magpie", "globalThis", `return ${body}`)
  return { ...pageDom, store, ready: run(pageDom.document, magpie, scope) }
}

/** A save is settled when the button is no longer busy. */
async function settled(app) {
  for (let i = 0; i < 200 && app.el("save").getAttribute("aria-busy") === "true"; i++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  await new Promise((resolve) => setImmediate(resolve))
}

test("the template the test builds is the one the page ships", () => {
  for (const cls of ["num", "field label", "label-input", "field key", "secret", "key-input", "show", "tools", "up", "down", "rm"]) {
    for (const name of cls.split(" ")) {
      assert.match(html, new RegExp(`class="${cls}"|class="[^"]*\\b${name}\\b`), `index.html has .${name}`)
    }
  }
})

test("an empty page says so, and can't save", async () => {
  const app = page()
  await app.ready
  assert.equal(app.el("empty").hidden, false)
  assert.equal(app.el("save").disabled, true)
  assert.equal(app.el("state").textContent, "")
})

test("a save says it worked with a check mark, and the button stops spinning", async () => {
  const app = page()
  await app.ready
  app.el("add").fire("click")
  const row = app.el("rows").children[0]
  const name = row.querySelector(".label-input")
  const key = row.querySelector(".key-input")
  name.value = "GPT 稳定分组"
  name.fire("input")
  key.value = KEY
  key.fire("input")

  assert.equal(app.el("save").disabled, false, "something to save")
  app.el("save").fire("click")
  await settled(app)

  assert.equal(app.el("save").getAttribute("aria-busy"), "false")
  assert.equal(app.el("save").textContent, "保存")
  assert.equal(app.el("state").textContent, "✓ 已保存")
  assert.equal(app.el("state").dataset.tone, "ok")
  assert.equal(app.el("save").disabled, true, "nothing left to save")
  assert.deepEqual(app.store.value.keys, [{ label: "GPT 稳定分组", key: KEY }])
})

test("the next edit clears the last answer", async () => {
  const app = page({ keys: [{ label: "old", key: KEY }] })
  await app.ready
  const row = app.el("rows").children[0]
  const name = row.querySelector(".label-input")
  name.value = "new"
  name.fire("input")
  app.el("save").fire("click")
  await settled(app)
  assert.equal(app.el("state").textContent, "✓ 已保存")

  const again = app.el("rows").children[0].querySelector(".label-input")
  again.value = "newer"
  again.fire("input")
  assert.equal(app.el("state").textContent, "", "an edit makes the last answer stale")
  assert.equal(app.el("save").disabled, false)
})

test("a failed save keeps the reason, in red, and can be tried again", async () => {
  const app = page({ keys: [{ label: "old", key: KEY }] }, { failSet: true })
  await app.ready
  const name = app.el("rows").children[0].querySelector(".label-input")
  name.value = "changed"
  name.fire("input")
  app.el("save").fire("click")
  await settled(app)

  assert.equal(app.el("state").textContent, "保存失败：bridge refused")
  assert.equal(app.el("state").dataset.tone, "error")
  assert.equal(app.el("save").disabled, false, "a failed save can be retried")
  assert.equal(app.el("save").textContent, "保存")
})

test("rows that can't be saved disable the button and say why", async () => {
  const app = page()
  await app.ready
  app.el("add").fire("click")
  const row = app.el("rows").children[0]
  const name = row.querySelector(".label-input")
  name.value = "没有密钥"
  name.fire("input")
  assert.equal(app.el("save").disabled, true)
  assert.equal(app.el("problems").hidden, false)
  assert.match(app.el("problems").textContent, /第 1 条：已填写名称，但密钥为空/)
})
