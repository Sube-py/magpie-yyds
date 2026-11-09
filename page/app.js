// The page: this plugin's keys, shown and edited, saved to its own options.
//
// It reads and writes nothing but `magpie.options` — no magpie reads are
// declared, and the frame has no network. A save passes the whole options
// object back (magpie's options are replaced, not merged), so anything the
// provider keeps there later is preserved.
//
// Saving restarts magpie's plugin host, which the page never sees end. So the
// three states are told apart rather than timed: the button spins while the
// save is out (`保存中…`), then a check mark says it worked and stays until
// the next edit, and a failure says what went wrong and stays until the next
// try. Nothing vanishes on a timer.

(async () => {
  const K = globalThis.YydsKeys
  const $ = (id) => document.getElementById(id)
  const theme = await magpie.ready
  const zh = String(theme?.lang ?? "").toLowerCase().startsWith("zh")

  const words = zh
    ? {
        save: "保存",
        saving: "保存中…",
        saved: "已保存",
        failed: "保存失败：",
        unchanged: "没有改动",
        loadFailed: "读取插件设置失败。",
      }
    : {
        save: "Save",
        saving: "Saving…",
        saved: "Saved",
        failed: "Save failed: ",
        unchanged: "Nothing to save",
        loadFailed: "Could not read the plugin's settings.",
      }

  let saved = {}
  let rows = []
  let busy = false

  /** The line beside the button: success, failure, or nothing. */
  function status(text, tone = "") {
    const state = $("state")
    state.textContent = text
    state.dataset.tone = tone
  }

  function setBusy(on) {
    busy = on
    const button = $("save")
    button.setAttribute("aria-busy", String(on))
    button.textContent = on ? words.saving : words.save
    button.disabled = on || !dirty() || K.problems(rows).length > 0
  }

  function shown(visible) {
    if (zh) return visible ? "隐藏" : "显示"
    return visible ? "Hide" : "Show"
  }

  function rowNode(row, index) {
    const node = $("row").content.firstElementChild.cloneNode(true)
    node.querySelector(".num").textContent = String(index + 1)
    const name = node.querySelector(".label-input")
    const key = node.querySelector(".key-input")
    name.value = row.label ?? ""
    key.value = row.key ?? ""
    name.placeholder = K.labelOf({ label: "", key: row.key ?? "" }, index)
    name.addEventListener("input", () => {
      rows[index].label = name.value
      edited()
    })
    key.addEventListener("input", () => {
      rows[index].key = key.value
      name.placeholder = K.labelOf({ label: "", key: key.value }, index)
      edited()
    })
    const show = node.querySelector(".show")
    show.addEventListener("click", () => {
      const visible = key.type === "text"
      key.type = visible ? "password" : "text"
      show.setAttribute("aria-pressed", String(!visible))
      show.textContent = shown(!visible)
    })
    const up = node.querySelector(".up")
    const down = node.querySelector(".down")
    up.disabled = index === 0
    down.disabled = index === rows.length - 1
    up.addEventListener("click", () => move(index, -1))
    down.addEventListener("click", () => move(index, 1))
    node.querySelector(".rm").addEventListener("click", () => {
      rows.splice(index, 1)
      paint()
      edited()
    })
    return node
  }

  function move(index, by) {
    const to = index + by
    if (to < 0 || to >= rows.length) return
    const [row] = rows.splice(index, 1)
    rows.splice(to, 0, row)
    paint()
    edited()
  }

  function paint() {
    $("rows").replaceChildren(...rows.map(rowNode))
    $("empty").hidden = rows.length > 0
  }

  /** Whether the rows differ from what is saved, so save means something. */
  function dirty() {
    return JSON.stringify(K.withKeys(saved, rows).keys) !== JSON.stringify(K.withKeys(saved, K.read(saved)).keys)
  }

  /** What is wrong right now, said under the list; save waits for a clean list. */
  function check() {
    const problems = K.problems(rows)
    const box = $("problems")
    box.replaceChildren(
      ...problems.map((p) => {
        const line = document.createElement("div")
        line.textContent = `第 ${p.index + 1} 条：${p.message}`
        return line
      }),
    )
    box.hidden = problems.length === 0
    $("save").disabled = busy || problems.length > 0 || !dirty()
  }

  /** Anything typed or removed: the last answer no longer describes these rows. */
  function edited() {
    status("")
    check()
  }

  async function save() {
    if (busy || K.problems(rows).length) return
    setBusy(true)
    status("")
    try {
      const current = (await magpie.options.get()) ?? saved
      const next = K.withKeys(current, rows)
      saved = (await magpie.options.set(next)) ?? next
      rows = K.read(saved)
      paint()
      status(`✓ ${words.saved}`, "ok")
    } catch (error) {
      status(words.failed + String(error?.message ?? error), "error")
    } finally {
      setBusy(false)
      check()
    }
  }

  $("add").addEventListener("click", () => {
    rows.push({ label: "", key: "" })
    paint()
    edited()
    const names = $("rows").querySelectorAll(".label-input")
    names[names.length - 1]?.focus()
  })
  $("save").addEventListener("click", save)

  try {
    saved = (await magpie.options.get()) ?? {}
    rows = K.read(saved)
  } catch {
    status(words.loadFailed, "error")
  }
  paint()
  check()
})().catch(() => {
  const state = document.getElementById("state")
  if (state) {
    state.textContent = "页面未能连接到 magpie"
    state.dataset.tone = "error"
  }
})
