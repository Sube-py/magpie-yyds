import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

const dir = join(import.meta.dirname, "..")
const page = join(dir, "page")
const read = (name) => readFileSync(join(page, name), "utf8")
const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))

// keys.js is a classic script, as the page loads it
const scope = {}
new Function("globalThis", read("keys.js"))(scope)
const K = scope.YydsKeys

const KEY_A = `sk-${"a".repeat(24)}`
const KEY_B = `sk-${"b".repeat(24)}`

test("the page is declared with no reads and no network", () => {
  assert.equal(pkg.magpie.page.title, "只因API 密钥")
  assert.equal(pkg.magpie.page.file, "page/index.html")
  assert.equal(pkg.magpie.page.icon, "page/icon.png")
  assert.deepEqual(pkg.magpie.permissions, [], "it reads nothing from magpie but its own options")
  for (const file of readdirSync(page).filter((f) => f.endsWith(".js") || f.endsWith(".html"))) {
    const text = read(file)
    assert.doesNotMatch(text, /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts|localStorage/, file)
    assert.doesNotMatch(text, /magpie\.read\(/, `${file} declares no reads, so it asks for none`)
  }
})

test("the page loads its scripts as files, never inline", () => {
  const html = read("index.html")
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[^<]/, "no inline script")
  assert.match(html, /<script src="_magpie\/bridge\.js">/)
  assert.match(html, /<script src="keys\.js">/)
  assert.match(html, /<script src="app\.js" defer>/)
  assert.doesNotMatch(html, /on(click|input|change)=/, "no inline handlers")
})

test("what is shown is what the options say", () => {
  assert.deepEqual(K.read({ keys: [{ label: "GPT", key: KEY_A }] }), [{ label: "GPT", key: KEY_A }])
  assert.deepEqual(K.read({ keys: [KEY_A] }), [{ label: "", key: KEY_A }])
  assert.deepEqual(K.read({}), [])
  assert.deepEqual(K.read(undefined), [])
})

test("a save writes the keys in the order typed, trimmed and deduplicated", () => {
  const options = { keys: [], somethingElse: 7 }
  const next = K.withKeys(options, [
    { label: "  Glm  ", key: ` ${KEY_B} ` },
    { label: "", key: "" },
    { label: "again", key: KEY_B },
    { label: "GPT", key: KEY_A },
  ])
  assert.deepEqual(next, {
    keys: [
      { label: "Glm", key: KEY_B },
      { label: "GPT", key: KEY_A },
    ],
    somethingElse: 7,
  })
  assert.deepEqual(K.withKeys({ keys: [{ label: "x", key: KEY_A }] }, []), { keys: [] }, "an emptied list saves empty")
})

test("a label is capped at 60 characters", () => {
  const [row] = K.normalize([{ label: "长".repeat(80), key: KEY_A }])
  assert.equal(row.label.length, 60)
})

test("what can't be saved is named, row by row", () => {
  const problems = K.problems([
    { label: "ok", key: KEY_A },
    { label: "not a key", key: "sk-short" },
    { label: "有名字没密钥", key: "" },
    { label: "", key: KEY_A },
  ])
  assert.deepEqual(problems, [
    { index: 1, message: "密钥需以 sk- 开头" },
    { index: 2, message: "已填写名称，但密钥为空" },
    { index: 3, message: "该密钥重复出现" },
  ])
  assert.deepEqual(K.problems([{ label: "", key: KEY_A }]), [])
  assert.deepEqual(K.problems([{ label: "", key: "" }]), [], "an untouched new row is not an error")
})

test("a row with no name is called by its key's end", () => {
  assert.equal(K.labelOf({ label: "GPT", key: KEY_A }), "GPT")
  assert.equal(K.labelOf({ label: "", key: KEY_A }), `sk-…${KEY_A.slice(-4)}`)
  assert.equal(K.labelOf({ label: "", key: "" }, 2), "第 3 条")
})

test("the copy counts keys as 条, never 把", () => {
  // 把 as a measure word reads badly next to 几; the page says 条 (or nothing)
  const banned = /几把|一把|每把|这把|那把|多把|两把|第一把|下一把/
  for (const file of readdirSync(page).filter((f) => f.endsWith(".html") || f.endsWith(".js"))) {
    assert.doesNotMatch(read(file), banned, file)
  }
  const html = read("index.html")
  assert.doesNotMatch(html, /随意|几把/, "the intro is written as documentation")
})

test("a save is told apart: spinner while out, check when done, reason when not", () => {
  const app = read("app.js")
  assert.doesNotMatch(app, /setTimeout|clearAfterMs/, "nothing vanishes on a timer")
  assert.match(app, /aria-busy/, "the button says it is saving")
  assert.match(app, /✓ \$\{words\.saved\}/, "success is a check mark, not the same words as the wait")
  assert.match(app, /status\(words\.failed \+/, "a failure keeps its reason")
  assert.match(app, /function edited\(\)[\s\S]{0,90}status\(""\)/, "the next edit clears the last answer")
})

test("the page's icon is the site's own, shipped beside the page", () => {
  // magpie serves magpie.page.icon from the page's folder, beside index.html
  const png = readFileSync(join(page, "icon.png"))
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "a PNG")
  assert.ok(png.length < 64 * 1024, "small enough to serve with the page")
  // and the provider card's icon is the same logo, inline: no remote fetch
  assert.match(pkg.magpie.icon, /^data:image\/png;base64,/)
})
