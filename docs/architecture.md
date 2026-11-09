# 架构说明：只因API 签到插件

这份文档是动手前的分析，也是代码的说明书：先讲结论，再讲为什么这样做，最后列出失败矩阵和验证方式。

## 1. 目标与边界

**要做的**：让 magpie 替只因API 的账号每天自动签到，顺便把这个站变成一个正常的 magpie 提供商（模型、余额、对话），因为 magpie 的签到挂在「提供商账号」上，没有账号就没有签到。

**最终结构：一个 provider、一条账号、密钥在账号下一层（插件 Options）**

```
只因API（yyds）
└── 账号 sube                会话：余额 + 每日签到
    ├── keys[0] GPT 稳定分组  插件 Options
    ├── keys[1] Glm
    └── 模型 = 各密钥分组的并集；请求按模型选第一个提供它的密钥
```

magpie 的插件 provider 里**没有“账号下挂密钥”的字段**：能放用户数据的面只有 ①登录方式（每条 = 一条平级账号）②开关 ③**插件 Options（JSON）** ④插件页面。把密钥做成账号 → 账号与它自己的密钥同级别（用户第一眼就指出）；把密钥做成 Options → 账号保持唯一，密钥回到账号下面，模型挂在账号上，正好是“账号 → 模型”的常规形状。

**不做的**：

- 不抓浏览器（读 localStorage / 驱动 Chrome）。站点是 SPA，会话只存在浏览器里，插件拿不到；让用户粘一次是唯一不越权的方式。
- 不破解人机验证。站点开了验证就返回 `captcha`，交给人。
- 不新建 `sk-` 密钥；密钥由用户在插件 Options 里给出，**顺序即偏好**（同一模型多个密钥都能服务时取第一个），不是插件随机挑。
- **登录账号时不问密钥**：签到和余额只需要会话；密钥是账号的设置，不是登录凭证。

## 2. 平台契约：签到挂在 provider 插件上

magpie 的插件是一个函数：

```js
export const YydsAuthPlugin = async ({ client }, options) => ({ config, provider, auth })
```

第二个参数是插件自己的设置（`magpie.options`，即 `plugins.json` 里的 `options`），本插件在这里读 `keys`。

签到由 `auth.checkin(getAuth, providerInfo)` 提供，magpie 自己负责「一天一次、按北京日切、失败 30 分钟重试、手动立即触发」（`internal/provider/plugin_checkin.go`）。插件只回答「今天这一下成不成」：

```js
{ outcome: "claimed" | "done" | "ineligible" | "inactive" | "captcha" | "failed", credit?, streak?, message?, until? }
```

因此本插件**不写定时器**——重复实现调度只会和 magpie 的记账（`plugin-checkin.json`）打架。

用到的其它钩子：

| 钩子 | 用途 |
| --- | --- |
| `config` | 提供商 id `yyds`、名称、npm `@ai-sdk/openai-compatible`、`api: <origin>/v1`、首屏模型兜底 |
| `provider.models` | 用账号的密钥读 `/v1/models`，失败时退回 magpie 手里的列表 |
| `auth.methods` | 三种登录方式 |
| `auth.loader` | 把密钥交给每次请求；401 时换密钥重发一次 |
| `auth.refresh` / `refreshLead` | 提前 5 分钟续期，续期结果写回账号 |
| `auth.usage` | 余额钱包窗口 + 密钥分组窗口 |
| `auth.checkin` | 每日签到 |
| `magpie.page`（`page/`） | 页：只因API 密钥。只读写自己的 options（`permissions: []`），保存后 magpie 重载插件宿主即可生效；`page.icon` 是页面目录里的 `icon.png`，magpie 用 `/_magpie/plugin/<token>/icon.png` 提供（实测 200 image/png） |
| 插件 `options`（`magpie.options`，`magpie plugin options`） | 这个账号的 `keys` 列表；改 Options 会重启插件宿主，因此立即生效 |

## 3. 站点事实（实测，2026-11-09）

| 事实 | 证据 |
| --- | --- |
| 平台是自研 `sub2api` 风格 REST：`/api/v1/*`，信封 `{code, message, data}`，`code: 0` 为成功 | `/api/v1/auth/me`、`/activity/checkin` 均为该形状 |
| 会话是 JWT，claims 为 `{user_id, email, role, token_version, sid, bnd, exp, nbf, iat}` | 解码 `auth_token` |
| 续期：`POST /auth/refresh {refresh_token}` → `{access_token, refresh_token, expires_in, user}`；失败 `401 + reason: REFRESH_TOKEN_INVALID` | 实测错误分支 |
| 签到读：`GET /api/v1/activity/checkin` → `{enabled, checked_in, amount, min_amount, max_amount, streak, continuous_streak, next_at, locked, frozen_amount, today_frozen, ...}` | 实测 |
| 签到领：`POST /api/v1/activity/checkin`，需要人机验证时带 `{proof}`；**今天已签到时同样返回 `code: 0` 和当天记录** | 实测（重复 POST 幂等） |
| 站点的日切在 `next_at`（`+08:00` 的 00:00） | 记录里给出 |
| 人机验证开关：`/api/v1/settings/public` 的 `checkin_captcha_enabled`（当前 `false`） | 实测 |
| 密钥：`/api/v1/keys?purpose=api` 返回 `key`（`sk-` + 64 位）、`status`、`expires_at`、`group`、`rate_limit_5h/1d/7d`、`usage_5h/1d/7d`、`window_*_start` | 实测 |
| 聊天模型：`GET /v1/models`（Bearer 密钥）只列该密钥所属分组的模型 | 实测：同一账号不同分组密钥给不同列表 |
| 余额：`/auth/me` 的 `balance`（美元）与 `frozen_balance` | 实测 `79.190222963` |

**关键推论**：签到和余额是账号级的（要 JWT），对话是密钥级的（要 `sk-`）且**一账号多个、按分组**；而 `sk-` 密钥打账号接口是 `401 INVALID_TOKEN`（实测 `/auth/me`、`/activity/checkin`、`/keys` 全部如此），所以两者无法合并成一种凭证，也正因为如此，密钥只能是账号的“设置”，不能变成账号本身。

## 4. 模块与职责

```
index.mjs              导出 YydsAuthPlugin（provider id: yyds）
src/constants.mjs      id、地址、时限、兜底模型
src/errors.mjs         YydsError：status / code / reason / signedOut / transient
src/api.mjs            YydsApi：信封解析、两种 base、超时、网络错误归一
src/jwt.mjs            claims / exp / 是否将过期
src/session.mjs        SessionKeeper：单飞续期、把新 token 写回账号
src/key.mjs            looksLikeKey：什么算一个密钥
src/keystore.mjs       keysOf：把 Options 里的 keys 读成 [{label, key}]
src/routing.mjs        KeyRouter：每个密钥的模型列表、并集、模型 → 密钥
src/loader.mjs         routedLoader：按模型选密钥发请求（含 404/401 处理）
src/models.mjs         ModelCatalog：实时模型列表 → magpie 的模型条目
src/catalog.mjs        ModelsDevCatalog：按 id 查 magpie 的 models.dev 目录（能力/上下文/价格）
src/usage.mjs          UsageReporter：余额 → usage 卡片
src/checkin.mjs        CheckinService：状态 → 判定 → 领取 → 结果映射
src/signin.mjs         SignInService：密码 / 粘贴会话两种登录
src/plugin.mjs         组装：provider 的 config / models / auth 钩子
page/index.html+app.js 页面：密钥的列表与编辑（bridge 只读 options）
page/keys.js           页面的纯逻辑（读取/校验/合并），被页面和测试共用
```

分层原则：**只有 `plugin.mjs` 认识 magpie**，其它模块只认识「站点 HTTP」和「纯数据」。所以每个模块都能在 Node 里直接单测（`tests/` 里 82 项：页面逻辑、静态检查，以及在最小 DOM 上跑真实 `page/app.js` 的交互）。

## 5. 关键流程

### 5.1 登录（密码）

```
authorize(inputs) → { callback() }
  callback → GET /settings/public         # 人机验证开了就拒绝并指向粘贴方式
           → POST /auth/login             # {email, password}
           → GET  /auth/me                # 账号名 / 余额 / id
           → { type: "success", accountId, uid, access, refresh, expires }

密钥账号（第三种登录方式，可加多次）：
  authorize({apiKey}) → GET /v1/models (用该密钥)   # 不能用就当场失败，带站点原话
                      → { type: "success", key, metadata: { email: "sk-…后四位" } }
```

`expires` 取 JWT 的 `exp`，没有 JWT 时退回 `expires_in`。账号登录**不读** `/keys`、不碰任何密钥。

### 5.2 续期（单飞）

```
current(record):
  未接近过期 → 原样返回
  接近过期 / 站点 401 → renew(record)
      同一 refresh_token 并发调用只发一次请求（Map 去重）
      成功后把结果保留 60s，供并发的其它钩子复用
      refresh 被拒（401 / REFRESH_TOKEN_INVALID）→ signedOut 错误
```

为什么必须单飞：refresh token 是一次性的，并发续期会让第二个请求拿着已作废的 token 把账号踢下线。

### 5.3 密钥（Options）与模型

```
options = {"keys": [{"label": "GPT 稳定分组", "key": "sk-…"}, …]}
keysOf(options) → [{label, key}]        # 顺序保留；不是密钥的形状直接丢掉；重复去掉

provider.models → 对每个密钥 GET /v1/models（各缓存 60s，带 owned_by）
                → 并集，模型 → 第一个提供它的密钥
                → 每个条目：magpie 交给钩子的条目（若有）＞ magpie 的 models.dev 目录（按 id，
                  owned_by 指到的厂商优先）＞ 内置小表（少数 id 的上下文）
                → 一个密钥都没配：不提供模型（也不报错）
                → 配了但一个都读不到：抛出「账号下的密钥均未能读取模型」（编辑器显示原因）
```

### 5.4 能力从哪来（为什么不自己写）

`provider.models` 返回的列表**逐个 id 替换** magpie 手里的条目（`host.js`：`out.models[k] = {...m, id, providerID}`）。所以钩子若返回“只有 id 和名字”的条目，magpie 原本从 models.dev 知道的能力（图片输入、推理、上下文、官方价）就被抹掉——第一版正是这样，界面上于是没有「思考程度 / 图片」。

现在条目以目录条目为底，只覆盖 `id / providerID / name / api / limit`，其余（`capabilities`、`cost`、`variants`…）原样保留：

```
src/catalog.mjs  ModelsDevCatalog.meta(id, ownedBy):
  path: $MAGPIE_MODELS_JSON ＞ $XDG_CACHE_HOME/magpie/models.json ＞ ~/.cache/magpie/models.json
  厂商: owned_by 映射（openai/anthropic/google/xai/deepseek/zhipu→zai/moonshot→moonshotai/…）
        ＞ 内置优先顺序 ＞ 任意知道该 id 的厂商
  缓存: 按 mtime（+60s TTL）；文件不在或读坏 → 未知，不抛错
```

实测（真站 5 个模型，目录补齐后）：`glm-5.3` ctx 1000000 / out 131072 / reasoning ✔ / image ✘ / cost 1.4；`deepseek-v4.1-flash` ctx 1000000 / out 128000 / reasoning ✔ / image ✔。

### 5.5 请求

```
loader(getAuth) → { baseURL: <origin>/v1, apiKey: "", fetch }
fetch(请求):
  读 body.model
  candidates = 提供该模型的密钥，按用户在 Options 里的顺序
  candidates 为空 → 本地返回 404 model_not_found（不发出去）
  依次尝试：401/403 视为这个密钥被拒 → 换下一个（同一模型）重试一次
```

为什么要读 body：密钥的选择只取决于 **模型**（分组决定模型），而 `loader` 的 `apiKey` 在请求之间是固定的，所以按请求改 `Authorization` 只能放在 `fetch` 里（raccoon 等插件也是这么做的）。

### 5.6 用量

余额是钱包窗口 `{name: "余额", balance, unit: "USD"}`，不带 `used`/`limit`，所以 magpie 把它当「有多少钱」而不是「用了百分之几」，路由也会据此比较同单位账号的余量。

## 6. 失败矩阵

| 失败 | 表现 | 谁负责 |
| --- | --- | --- |
| refresh 被拒 | `signedOut` → 卡片「请重新登录」，账号被标记过期 | 插件 |
| 站点 5xx / 超时 | usage 卡片写错误但 `signIn: kept`，不误判登录态 | 插件 |
| 密钥被吊销 | 该密钥被跳过，换下一个提供同模型的密钥重试一次；都不行则 401/403 原样报出 | 插件 |
| 密钥填错 / 不在任何分组 | 读不到模型 → 编辑器报「一个也没读到模型」 | 插件 |
| 模型没有密钥提供 | 404 `model_not_found`，不发请求 | 插件 |
| 把密钥填进「账号」登录 | 拒绝，并指到插件 Options 的 keys | 插件 |
| 只加了账号、没加密钥 | 签到和余额正常，没有可对话的账号 | 用户按需添加 |
| 签到要验证码 | `captcha`，magpie 文案让人去网站 | 插件 |
| 签到当天已领 | `done`，不重复记账 | 插件 |
| 站点彻底不可达 | 抛错，magpie 1 分钟后再问 | 插件 + magpie |
| 一天只签一次 | `plugin-checkin.json` 按账号记账 | magpie |

## 7. 安全

- 密码只在登录那一次用，不落盘；落盘的是会话 token（与 OpenCode / magpie 其它插件一致，权限由 magpie 的 `plugin-auth.json` 控制）。
- 不读浏览器、不读 cookie、不碰站点之外的主机（`YYDS_ORIGIN` 只给镜像和测试用）。
- 人机验证不破解；需要验证时明确交回给人。
- 错误信息只保留站点原话，不回显 token。

## 8. 验证

1. `npm test` — 67 项：信封与错误映射、单飞续期、密钥挑选、余额窗口、三种登录、签到状态机、插件集成（本地假站点）。
2. 真站只读验证：`/v1/models`、`/activity/checkin`、`/auth/me`、`/keys` 用实际响应校准（见 §3）。
3. 沙箱真机验证（隔离 `HOME` + `YYDS_ORIGIN` 指向本地假站点，两个分组的两个密钥）：

```
$ magpie plugin options <path> '{"keys":[{"label":"GPT 稳定分组","key":"sk-a…"},{"label":"Glm","key":"sk-b…"}]}'
$ magpie providers
  只因API  yyds  ● signed in as sube   3 of 3 models

$ magpie provider test yyds gpt-6.1-sol   → 假站点记录：gpt-6.1-sol <- sk-aaaaaaaaa
$ magpie provider test yyds glm-5.3       → 假站点记录：glm-5.3     <- sk-bbbbbbbbb
$ magpie provider test yyds shared        → 假站点记录：shared      <- sk-aaaaaaaaa（都能服务，取第一个）
```

即：一个账号、一个模型列表（并集）、请求按模型落到对应分组的密钥，同一模型的抢先用 Options 里排在前面的那个。
4. 真站只读/签到验证（0.1.0 时期，隔离 `HOME`，真实会话）：`signed in as sube`、余额 79.19 USD、`magpie accounts checkin` 成功。

## 9. 前端 / 后端的分工（怎么继续做）

| 面 | 归属 | 现状 |
| --- | --- | --- |
| 提供商卡片、模型列表、余额与窗口、签到结果文案 | 前端（插件声明给 magpie 呈现的部分） | 完成；全部走 magpie 现有组件，没有自绘 UI |
| 账号 → 密钥 → 模型 的层级、登录提示与校验文案、失败文案、Options 示例、提供商图标 | 前端 | 完成（图标为官网 logo，128px PNG 内嵌；Options 示例写在 `package.json` 的 `magpie.options`） |
| 站点 HTTP 客户端、会话续期、签到状态机、密钥挑选 | 后端 | 完成 |
| 后续可做 | 后端 | 站点若开签到验证码，加一个「粘贴 proof」的签到入口；模型上下文可由模型广场接口补全 |
