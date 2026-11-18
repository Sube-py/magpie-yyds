import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { accountName, configDir, sessionToken } from "../lib/config.mjs"
import { startServer } from "../lib/server.mjs"

const root = join(import.meta.dirname, "..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))

/** A config folder with a signed-in account, as the provider plugin leaves it. */
async function withConfig(run) {
  const dir = mkdtempSync(join(tmpdir(), "yyds-usage-"))
  writeFileSync(
    join(dir, "plugin-auth.json"),
    JSON.stringify({ yyds: { type: "oauth", access: "tok-123", accountId: "sube" } }),
  )
  try {
    return await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("the page is declared with its own service and no reads", () => {
  assert.equal(pkg.magpie.page.title, "只因API 用量")
  assert.equal(pkg.magpie.page.file, "page/index.html")
  assert.deepEqual(pkg.magpie.page.service, { port: 3491, option: "port" })
  assert.equal(pkg.magpie.permissions, undefined, "it reads magpie's files itself, through its service")
})

test("the page reaches nothing but its own service", () => {
  for (const file of readdirSync(join(root, "web"))) {
    const text = readFileSync(join(root, "web", file), "utf8")
    assert.doesNotMatch(text, /https?:\/\/(?!www\.w3\.org)/, `${file} names no remote host`)
    assert.doesNotMatch(text, /magpie\.read\(/, `${file} reads nothing through the bridge`)
  }
  const boot = readFileSync(join(root, "page/boot.js"), "utf8")
  assert.match(boot, /127\.0\.0\.1/, "the boot page knows the local service")
  assert.doesNotMatch(boot, /\bfetch\(/, "a boot page can't fetch: it navigates")
})

test("the session is read from magpie's own folder, and never written", () =>
  withConfig(async (dir) => {
    assert.equal(sessionToken(dir), "tok-123")
    assert.equal(accountName(dir), "sube")
    const before = readFileSync(join(dir, "plugin-auth.json"), "utf8")
    sessionToken(dir)
    assert.equal(readFileSync(join(dir, "plugin-auth.json"), "utf8"), before)
  }))

test("no sign-in, no token", () => {
  const dir = mkdtempSync(join(tmpdir(), "yyds-empty-"))
  try {
    assert.equal(sessionToken(dir), "")
    assert.equal(accountName(dir), "")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("magpie's folder is the one the app uses", () => {
  assert.equal(configDir({ MAGPIE_CONFIG_DIR: "/tmp/m" }, "/home/u"), "/tmp/m")
  assert.equal(configDir({ XDG_CONFIG_HOME: "/c" }, "/home/u"), "/c/magpie")
  assert.equal(configDir({}, "/home/u"), "/home/u/.config/magpie")
})

test("the service answers its page and its summary, and refuses other hosts", () =>
  withConfig(async (dir) => {
    const site = {
      me: async (token) => {
        assert.equal(token, "tok-123", "the session is the account's")
        return { username: "sube", balance: 43.18, total_recharged: 266.55 }
      },
      requests: async () => [
        { at: Date.parse("2026-11-18T09:00:00+08:00"), model: "glm-5.3", tokens: 10, cost: 3.05, listCost: 30.5 },
      ],
    }
    const server = await startServer({ port: 0, dir, site })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const page = await fetch(`${base}/`)
      assert.equal(page.status, 200)
      assert.match(await page.text(), /只因API 用量/)
      const summary = await (await fetch(`${base}/api/summary?days=7`)).json()
      assert.equal(summary.user, "sube")
      assert.equal(summary.balance, 43.18)
      assert.equal(summary.spent, 3.05)
      const css = await fetch(`${base}/style.css`)
      assert.match(css.headers.get("content-type"), /text\/css/)
    } finally {
      await server.close()
    }
  }))

test("with no sign-in the service says so instead of failing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yyds-usage-"))
  const server = await startServer({ port: 0, dir, site: { me: async () => ({}), requests: async () => [] } })
  try {
    const summary = await (await fetch(`http://127.0.0.1:${server.port}/api/summary`)).json()
    assert.match(summary.error, /还没登录只因API/)
  } finally {
    await server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a site that refuses is a message, not a crash", () =>
  withConfig(async (dir) => {
    const site = {
      me: async () => {
        throw new Error("只因API 的登录已失效，请重新登录")
      },
      requests: async () => [],
    }
    const server = await startServer({ port: 0, dir, site })
    try {
      const summary = await (await fetch(`http://127.0.0.1:${server.port}/api/summary`)).json()
      assert.match(summary.error, /登录已失效/)
    } finally {
      await server.close()
    }
  }))
