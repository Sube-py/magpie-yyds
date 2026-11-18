// Fills the card's balance curve with the account's real history.
//
// magpie keeps a window's history itself (`quota-history.json`), but only from
// the day a window first reports: the 余额 line therefore starts today and has
// nothing behind it. The site's ledger does have the past, so this walks it
// back — balance(t) = balance now + everything charged after t — and writes
// those readings into magpie's own file as if the card had been read then.
//
//   node tools/backfill-curve.mjs [--days 45] [--every 6] [--dry-run]
//
// It writes only that one line, under the provider this plugin serves, and only
// points older than the ones magpie already has; a backup is kept beside it.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { configDir, PROVIDER_ID, sessionToken } from "../lib/config.mjs"
import { balanceCurve, range, SiteUsage, siteDay } from "../lib/site.mjs"

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return fallback
  const value = Number(args[i + 1])
  return Number.isFinite(value) && value > 0 ? value : fallback
}
const days = Math.min(flag("days", 45), 45) // magpie keeps 45 days, no more
const every = flag("every", 6) // hours between points
const dryRun = args.includes("--dry-run")
const WINDOW = "余额"

const token = sessionToken()
if (!token) {
  console.error("还没登录只因API：先在「提供商 → 只因API」里登录一次")
  process.exit(1)
}

const site = new SiteUsage()
const me = await site.me(token)
const balance = Number(me?.balance) || 0
const recharged = Number(me?.total_recharged) || 0
if (!(recharged > 0)) {
  console.error("这个账号没有累计充值（total_recharged 为 0），余额没有分母，不写曲线")
  process.exit(1)
}

const { from, to } = range(days)
const requests = await site.requests(token, { from, to })
console.log(`读到 ${requests.length} 条请求（${from} → ${to}）`)
const spentInRange = requests.reduce((sum, r) => sum + r.cost, 0)
if (balance + spentInRange > recharged + 0.01) {
  console.warn(
    `注意：余额 $${balance.toFixed(2)} + 区间消费 $${spentInRange.toFixed(2)} 超过了累计充值 $${recharged.toFixed(2)}，` +
      "说明窗口内有充值（或赠送）：倒推出来的历史会偏高。",
  )
}

// one point every `every` hours, from the window's start to now
const now = Date.now()
const step = every * 3_600_000
const at = []
for (let t = Date.parse(`${from}T00:00:00+08:00`); t < now; t += step) at.push(t)
at.push(now)

const byTime = [...requests].sort((a, b) => a.at - b.at)
let index = byTime.length
let running = balance
const points = []
for (let i = at.length - 1; i >= 0; i--) {
  const moment = at[i]
  while (index > 0 && byTime[index - 1].at > moment) {
    running += byTime[index - 1].cost
    index--
  }
  const left = Math.max(0, Math.min(100, (running / recharged) * 100))
  points.push({ at: new Date(moment).toISOString().replace(/\.\d+Z$/, "Z"), left: round2(left) })
}
points.reverse()

const path = join(configDir(), "quota-history.json")
const file = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}
const key = `${PROVIDER_ID}|${me?.username ?? ""}`
const line = file[key]?.[WINDOW] ?? []
const oldest = line.length ? Math.min(...line.map((p) => Date.parse(p.at))) : Infinity
const fresh = points.filter((p) => Date.parse(p.at) < oldest - 60_000)

console.log(`${WINDOW}: 已有 ${line.length} 点，补 ${fresh.length} 点（到 ${to}，每 ${every} 小时一个）`)
if (!fresh.length) {
  console.log("没有更早的点可补：曲线已经在")
  process.exit(0)
}
const merged = [...fresh, ...line].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-6000)
if (dryRun) {
  console.log("dry run：不写文件。前 3 点：", merged.slice(0, 3))
  process.exit(0)
}
const backup = `${path}.bak-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`
copyFileSync(path, backup)
file[key] = { ...(file[key] ?? {}), [WINDOW]: merged }
writeFileSync(path, JSON.stringify(file))
console.log(`写好 ${merged.length} 点（${merged[0].at} → ${merged.at(-1).at}）`)
console.log(`备份：${backup}`)
console.log(`曲线：${siteDay(Date.parse(merged[0].at))} ${merged[0].left}% → ${siteDay(Date.parse(merged.at(-1).at))} ${merged.at(-1).left}%`)

// what the page draws, for a quick look in a terminal
const curve = balanceCurve(requests, { balanceNow: balance, now, max: 8 })
console.log("余额（美元，抽样）：", curve.map((p) => `${siteDay(p.at)} $${p.amount}`).join("  "))

function round2(value) {
  return Math.round(value * 100) / 100
}
