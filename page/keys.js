// The keys form, as pure functions: what the page shows, and what it saves.
//
// `keys` lives in this plugin's own options (plugins.json), so the provider
// reads it as its settings and a save is followed by magpie starting the
// plugin host again — the page only has to write a clean list.
//
// Loaded as a classic script by the page (globalThis.YydsKeys) and by the
// test with `new Function`, as the other page packages do.

const KEY = /^sk-[A-Za-z0-9_-]{8,}$/
const LABEL_MOST = 60

/** The rows behind an options object. */
function read(options) {
  const list = Array.isArray(options?.keys) ? options.keys : []
  const rows = []
  for (const entry of list) {
    if (typeof entry === "string") rows.push({ label: "", key: entry })
    else if (entry && typeof entry === "object") rows.push({ label: String(entry.label ?? ""), key: String(entry.key ?? "") })
  }
  return rows
}

/** Trimmed, capped labels; blank rows dropped; a key listed once. */
function normalize(rows) {
  const out = []
  const seen = new Set()
  for (const row of Array.isArray(rows) ? rows : []) {
    const label = String(row?.label ?? "").trim().slice(0, LABEL_MOST)
    const key = String(row?.key ?? "").trim()
    if (!key) {
      // a label with no key is nothing to save yet
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ label, key })
  }
  return out
}

/**
 * What is wrong with the rows as typed, one `{index, message}` each: a key
 * that isn't one, or a label with no key under it.
 */
function problems(rows) {
  const out = []
  const seen = new Set()
  ;(Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const label = String(row?.label ?? "").trim()
    const key = String(row?.key ?? "").trim()
    if (!key) {
      if (label) out.push({ index, message: "已填写名称，但密钥为空" })
      return
    }
    if (!KEY.test(key)) out.push({ index, message: "密钥需以 sk- 开头" })
    if (seen.has(key)) out.push({ index, message: "该密钥重复出现" })
    seen.add(key)
  })
  return out
}

/** What is saved: the whole options object, with `keys` replaced. */
function withKeys(options, rows) {
  return { ...(options && typeof options === "object" ? options : {}), keys: normalize(rows) }
}

/** A label to show when the person gave none. */
function labelOf(row, index) {
  const label = String(row?.label ?? "").trim()
  if (label) return label
  const key = String(row?.key ?? "").trim()
  return key ? `sk-…${key.slice(-4)}` : `第 ${index + 1} 条`
}

globalThis.YydsKeys = { LABEL_MOST, read, normalize, problems, withKeys, labelOf }
