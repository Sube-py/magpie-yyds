import assert from "node:assert/strict"
import test from "node:test"

import { KEYS_EXAMPLE, keysOf } from "../src/keystore.mjs"

const KEY_A = `sk-${"a".repeat(24)}`
const KEY_B = `sk-${"b".repeat(24)}`

test("keys come out as they were configured, in order", () => {
  const keys = keysOf({ keys: [{ label: "GPT", key: KEY_A }, { label: "Glm", key: KEY_B }] })
  assert.deepEqual(keys, [
    { label: "GPT", key: KEY_A },
    { label: "Glm", key: KEY_B },
  ])
})

test("a bare string is a key with no label", () => {
  assert.deepEqual(keysOf({ keys: [KEY_A] }), [{ label: "", key: KEY_A }])
})

test("what isn't a key is left out, and so is a repeat", () => {
  const keys = keysOf({
    keys: [KEY_A, "not-a-key", "", null, { key: KEY_A }, { label: "no key" }, { label: "tail", key: KEY_B }],
  })
  assert.deepEqual(keys, [
    { label: "", key: KEY_A },
    { label: "tail", key: KEY_B },
  ])
})

test("no options, or options of another shape, are no keys", () => {
  assert.deepEqual(keysOf(undefined), [])
  assert.deepEqual(keysOf({}), [])
  assert.deepEqual(keysOf({ keys: "sk-nope0000" }), [])
  assert.deepEqual(keysOf({ keys: { key: KEY_A } }), [])
})

test("a long label is cut, and a non-string label is dropped", () => {
  const [long] = keysOf({ keys: [{ label: "长".repeat(90), key: KEY_A }] })
  assert.equal(long.label.length, 60)
  const [odd] = keysOf({ keys: [{ label: 42, key: KEY_B }] })
  assert.equal(odd.label, "")
})

test("the example offered in the editor is one the parser keeps", () => {
  assert.equal(keysOf(KEYS_EXAMPLE).length, 1)
  assert.equal(keysOf(KEYS_EXAMPLE)[0].label, "GPT 稳定分组")
})
