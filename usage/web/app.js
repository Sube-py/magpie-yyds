// The page: draws what the service says. No network of its own — every number
// is fetched from `/api/summary` on the same origin, which is the plugin's
// local service reading the site with the account's session.

const $ = (id) => document.getElementById(id)
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`
const money4 = (n) => {
  const v = Number(n) || 0
  return v >= 100 ? `$${v.toFixed(0)}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`
}
const count = (n) => (Number(n) || 0).toLocaleString("zh-CN")

const state = { days: Number(new URLSearchParams(location.search).get("days")) || 30, data: null }

function say(text, bad = false) {
  const box = $("error")
  box.textContent = text
  box.hidden = !text
  box.dataset.bad = String(bad)
}

/** An SVG line chart: `points` of `{x, y}` in data units, y labelled in dollars. */
function lineChart(host, points, { height = 180, yFormat = money4 } = {}) {
  host.replaceChildren()
  if (points.length < 2) {
    host.textContent = "数据点还不够（至少两次读取才能画出线）"
    return
  }
  const W = 720
  const H = height
  const pad = { l: 52, r: 10, t: 10, b: 22 }
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const spanX = x1 - x0 || 1
  const spanY = y1 - y0 || 1
  const sx = (x) => pad.l + ((x - x0) / spanX) * (W - pad.l - pad.r)
  const sy = (y) => H - pad.b - ((y - y0) / spanY) * (H - pad.t - pad.b)

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`)
  svg.setAttribute("preserveAspectRatio", "none")
  svg.setAttribute("class", "svg-chart")

  const ticks = 4
  for (let i = 0; i <= ticks; i++) {
    const value = y0 + ((y1 - y0) * i) / ticks
    const y = sy(value)
    const grid = document.createElementNS("http://www.w3.org/2000/svg", "line")
    grid.setAttribute("x1", pad.l)
    grid.setAttribute("x2", W - pad.r)
    grid.setAttribute("y1", y)
    grid.setAttribute("y2", y)
    grid.setAttribute("class", "grid")
    svg.append(grid)
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text")
    label.setAttribute("x", pad.l - 8)
    label.setAttribute("y", y + 4)
    label.setAttribute("text-anchor", "end")
    label.setAttribute("class", "tick")
    label.textContent = yFormat(value)
    svg.append(label)
  }

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ")
  const line = document.createElementNS("http://www.w3.org/2000/svg", "path")
  line.setAttribute("d", path)
  line.setAttribute("class", "line")
  svg.append(line)

  const area = document.createElementNS("http://www.w3.org/2000/svg", "path")
  area.setAttribute("d", `${path} L${sx(points[points.length - 1].x).toFixed(1)},${H - pad.b} L${sx(points[0].x).toFixed(1)},${H - pad.b} Z`)
  area.setAttribute("class", "area")
  svg.insertBefore(area, line)

  for (const at of [0, points.length - 1]) {
    const p = points[at]
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle")
    dot.setAttribute("cx", sx(p.x))
    dot.setAttribute("cy", sy(p.y))
    dot.setAttribute("r", 3)
    dot.setAttribute("class", "dot")
    svg.append(dot)
  }
  const first = document.createElementNS("http://www.w3.org/2000/svg", "text")
  first.setAttribute("x", pad.l)
  first.setAttribute("y", H - 6)
  first.setAttribute("class", "tick")
  first.textContent = dayOf(points[0].x)
  svg.append(first)
  const last = document.createElementNS("http://www.w3.org/2000/svg", "text")
  last.setAttribute("x", W - pad.r)
  last.setAttribute("y", H - 6)
  last.setAttribute("text-anchor", "end")
  last.setAttribute("class", "tick")
  last.textContent = dayOf(points[points.length - 1].x)
  svg.append(last)

  host.append(svg)
}

/** Daily bars, one a day, the tallest day at the top. */
function barChart(host, days, { height = 140 } = {}) {
  host.replaceChildren()
  if (!days.length) return
  const W = 720
  const H = height
  const pad = { l: 52, r: 10, t: 8, b: 20 }
  const top = Math.max(...days.map((d) => d.cost), 0.01)
  const slot = (W - pad.l - pad.r) / days.length
  const width = Math.max(1, slot * 0.7)
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`)
  svg.setAttribute("preserveAspectRatio", "none")
  svg.setAttribute("class", "svg-chart")
  for (const value of [0, top / 2, top]) {
    const y = H - pad.b - ((value / top) * (H - pad.t - pad.b))
    const grid = document.createElementNS("http://www.w3.org/2000/svg", "line")
    grid.setAttribute("x1", pad.l)
    grid.setAttribute("x2", W - pad.r)
    grid.setAttribute("y1", y)
    grid.setAttribute("y2", y)
    grid.setAttribute("class", "grid")
    svg.append(grid)
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text")
    label.setAttribute("x", pad.l - 8)
    label.setAttribute("y", y + 4)
    label.setAttribute("text-anchor", "end")
    label.setAttribute("class", "tick")
    label.textContent = money4(value)
    svg.append(label)
  }
  days.forEach((day, i) => {
    if (day.cost <= 0) return
    const h = (day.cost / top) * (H - pad.t - pad.b)
    const bar = document.createElementNS("http://www.w3.org/2000/svg", "rect")
    bar.setAttribute("x", pad.l + i * slot + (slot - width) / 2)
    bar.setAttribute("y", H - pad.b - h)
    bar.setAttribute("width", width)
    bar.setAttribute("height", Math.max(1, h))
    bar.setAttribute("class", "bar")
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title")
    title.textContent = `${day.date} · ${money(day.cost)} · ${count(day.requests)} 次`
    bar.append(title)
    svg.append(bar)
  })
  host.append(svg)
}

function dayOf(at) {
  return new Date(at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
}

function tiles(data) {
  const spent = data.spent
  const left = data.recharged > 0 ? data.balance / data.recharged : null
  return [
    { label: "余额", value: money(data.balance), sub: data.recharged ? `累计充值 ${money(data.recharged)}` : "" },
    { label: "今日消费", value: money(data.today?.cost), sub: `${count(data.today?.requests)} 次` },
    { label: `${data.days.length} 天消费`, value: money(spent), sub: `${count(data.requests)} 次请求` },
    {
      label: "剩余比例",
      value: left === null ? "—" : `${(left * 100).toFixed(1)}%`,
      sub: left === null ? "没有充值记录" : "余额 / 累计充值",
    },
  ]
}

function paint() {
  const data = state.data
  if (!data) return
  for (const button of $("ranges").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.days) === state.days))
  }
  $("who").textContent = data.user ? `${data.user} · ${data.from} → ${data.to}` : `${data.from} → ${data.to}`
  $("tiles").replaceChildren(
    ...tiles(data).map((tile) => {
      const box = document.createElement("div")
      box.className = "tile"
      for (const [cls, text] of [["k", tile.label], ["v", tile.value], ["s", tile.sub]]) {
        const el = document.createElement("div")
        el.className = cls
        el.textContent = text
        box.append(el)
      }
      return box
    }),
  )
  $("curve-note").textContent = data.toppedUp
    ? "窗口内有充值：倒推值偏高"
    : "从今天的余额按之后每笔消费倒推"
  lineChart($("curve"), data.curve.map((p) => ({ x: p.at, y: p.amount })))
  barChart($("daily"), data.days)

  $("models").replaceChildren(
    ...data.models.slice(0, 8).map((model) => {
      const row = document.createElement("li")
      row.innerHTML = `<span class="m">${escapeHtml(model.model)}</span><span class="r">${count(model.requests)} 次</span><span class="c">${money(model.cost)}</span>`
      return row
    }),
  )
  $("records").replaceChildren(
    ...data.recent.slice(0, 20).map((record) => {
      const row = document.createElement("li")
      const when = new Date(record.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
      row.innerHTML = `<span class="t">${when}</span><span class="m">${escapeHtml(record.model)}</span><span class="r">${count(record.tokens)} tok</span><span class="c">${money4(record.cost)}</span>`
      return row
    }),
  )
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
}

async function load(days = state.days) {
  state.days = days
  say("")
  $("ranges").setAttribute("aria-busy", "true")
  try {
    const res = await fetch(`/api/summary?days=${days}`, { headers: { accept: "application/json" } })
    const data = await res.json()
    if (data?.error) {
      state.data = null
      say(data.error, true)
      return
    }
    state.data = data
    paint()
  } catch (error) {
    say(`读不到数据：${error?.message ?? error}`, true)
  } finally {
    $("ranges").removeAttribute("aria-busy")
  }
}

$("ranges").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-days]")
  if (button) load(Number(button.dataset.days))
})

// the window's theme, as magpie names it in the URL it was opened with
const query = new URLSearchParams(location.search)
if (query.get("theme") === "dark") document.documentElement.dataset.theme = "dark"
if (query.get("theme") === "light") document.documentElement.dataset.theme = "light"

load()
