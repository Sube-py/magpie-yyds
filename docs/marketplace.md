# Putting it in magpie's plugin market

Two separate things, and only the first is in this repository:

1. **The npm package** — `magpie-yyds`. Once published, anyone can install
   it by name:
   ```sh
   magpie plugin add magpie-yyds
   ```
2. **The market entry** — magpie's Plugins tab lists what
   [`magpie-community/plugins`'s `registry.json`](https://github.com/magpie-community/plugins/blob/main/registry.json)
   names, so being on npm is not enough: the entry below goes there as a pull
   request (`matcher: package name`, `providers`, a summary in English and
   Chinese).

## The entry

```json
{
  "package": "magpie-yyds",
  "name": "只因API",
  "icon": "https://raw.githubusercontent.com/Sube-py/magpie-yyds/main/page/icon.png",
  "providers": ["yyds"],
  "community": true,
  "summary": {
    "en": "yydsapi (只因API) with the account's own sign-in: the daily check-in and the wallet, and chats on the sk- keys the account holds — one key per group, each request routed to the key whose group serves its model",
    "zh": "只因API（yydsapi）：用账号自己的登录做每日签到和余额，用账号里的 sk- 密钥对话——一个分组一个密钥，请求按模型交给提供它的那个密钥"
  }
}
```

Insert it into `registry.json`'s `plugins` array (alphabetical by package name),
then open the pull request. That repository judges a new package by **channel**:
the channel here is 只因API / `yydsapi.uno`, and no entry there signs in to it,
so this is a new one rather than a second package for a listed channel.

## Publishing, in order

1. **The first version**, once, with a signed-in npm CLI (a token, or
   `npm login` on the machine that runs it):
   ```sh
   npm publish --access public
   ```
   Trusted publishing can't create the first version — a Trusted Publisher is
   set on a package that exists.
2. **A Trusted Publisher** on npmjs.com, package `magpie-yyds` →
   Settings → Trusted Publisher → GitHub:
   - repository: `Sube-py/magpie-yyds`
   - workflow: `publish.yml`
   - environment: (none)
3. **Every version after that** publishes itself from a tag — no token stored
   anywhere, and the tarball carries a provenance statement:
   ```sh
   npm version patch        # or minor / major
   git push --follow-tags
   ```

`.github/workflows/publish.yml` in this repository does step 3 (and
step 1 too, if an `NPM_TOKEN` secret is set: that is the only way the very first
version can come from CI).
