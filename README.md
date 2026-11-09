# magpie-yyds

[只因API](https://www.yydsapi.uno)（`yydsapi.uno`）的 magpie 插件。**一个提供商、一个账号，密钥挂在账号下面**：

```
只因API（yyds）
└── 账号 sube              余额 + 每日签到（会话）
    ├── 密钥 GPT 稳定分组    ← 插件 Options 里的 keys
    ├── 密钥 Glm
    └── 模型 = 这些密钥分组的并集，请求按模型落到服务它的那个密钥
```

## 为什么是这个形状

- 站点的**签到和余额属于账号**，而 `sk-` 密钥打账号接口一律 `401 INVALID_TOKEN`（实测 `/auth/me`、`/activity/checkin`、`/keys`），所以签到只能用会话。
- **对话按密钥计费**，一个密钥属于一个分组，分组决定它能用的模型。所以对话只能用密钥。
- magpie 的插件 provider 里**没有“账号下挂密钥”这种字段**：账号是登录出来的（一层平面列表），账号之外能给插件放用户数据的只有开关、**插件 Options** 和插件页面。把密钥做成账号，就会出现“账号和它自己的密钥同级别”的怪样子。

所以：**账号只有一条（会话），密钥是插件的设置（Options），账号的模型是密钥分组的并集。**

## 安装

```sh
magpie plugin add magpie-yyds-auth          # 从 npm
magpie plugin add /Users/sube/me/magpie-yyds # 或者从本地这份源码
```

源码与发布：[github.com/Sube-py/magpie-yyds-auth](https://github.com/Sube-py/magpie-yyds-auth)；进 magpie 插件市场要的 `registry.json` 条目见 [docs/marketplace.md](docs/marketplace.md)。

图标用的是只因官网的 logo：提供商卡片用 `package.json` 里内嵌的 `magpie.icon`，侧栏的插件页面用同图的文件 `page/icon.png`（magpie 从页面目录里取，不联网）。

## 1. 登录账号（签到 / 余额）

**提供商 → 只因API → 登录**，两种方式：

| 方式 | 要填 | 说明 |
| --- | --- | --- |
| 只因API 账号（邮箱 + 密码） | 邮箱、密码 | 密码只在这次登录用，不落盘 |
| 只因API 账号（粘贴浏览器会话） | `auth_token` 或 `refresh_token` | 站点开了人机验证时用这个 |

取会话：在只因API 网站登录后 F12 → Application → Local Storage → 复制 `auth_token` 的值（或整段 JSON，带 `refresh_token` 更好，能自动续期）。

**每日签到**：**设置 → 用量 → 插件 → 只因API → 每日签到**（默认关）打开即可，之后 magpie 每天替这个账号按一次。想立刻按一次：`magpie accounts checkin`，或卡片上的 **Check in now**。

## 2. 加密钥（对话）

密钥**不是账号**，所以不在「添加账号」里加。打开侧栏 **插件 → 只因API 密钥** 这个页面：

- 点「添加密钥」，填名字（建议填分组名，例如 `GPT 稳定分组`）和 `sk-…`；
- 上下箭头调整顺序（顺序 = 偏好），删除按钮去掉一个；
- 「保存」时按钮转圈并显示「保存中…」，成功后按钮旁出现绿色「✓ 已保存」（再改内容才清空）；失败会写明原因，可直接重试。

不想用页面也可以直接改 Options（**插件 → 已安装 → magpie-yyds → Options**）或命令行：

```json
{ "keys": [ { "label": "GPT 稳定分组", "key": "sk-..." }, { "label": "Glm", "key": "sk-..." } ] }
```

```sh
magpie plugin options /Users/sube/me/magpie-yyds '{"keys":[{"label":"GPT 稳定分组","key":"sk-..."}]}'
```

规则：

- **顺序就是你写的顺序**：一个模型如果多个密钥都提供，就用排在前面那个；
- 每个密钥加进来时会用 `GET /v1/models` 读它所属分组的模型，读不到的那个不提供任何模型（并报出原因）；
- 只写字符串也行：`{"keys": ["sk-..."]}`；
- 改了 Options 之后 magpie 会重启插件宿主，立刻生效；
- 密钥明文存在 magpie 的 `plugins.yml` 里（和 `plugin-auth.json` 同一个级别）。

## 模型与请求

- 账号的模型 = 所有密钥分组的并集（`GET /v1/models`，每个一次）。
- 一个请求按它要的模型选密钥：第一个列出该模型的密钥。
- 这个密钥被站点拒绝（401/403）时，自动换下一个也提供该模型的密钥，重试一次。
- 没有任何密钥提供该模型 → 插件当场返回 `404 model_not_found`，请求不会发出去（magpie 会换下一个提供商）。

## 签到结果

| 结果 | 含义 |
| --- | --- |
| `claimed` | 刚刚签上，附本次金额和连续天数 |
| `done` | 今天已经签过（金额可能是「冻结中」） |
| `inactive` | 站点关掉了签到 |
| `ineligible` | 账号被锁定 / 不能参与 |
| `captcha` | 站点要人机验证，插件不解答，请到网站手动签 |
| `failed` | 其它失败，带站点原话 |

## 卡片上的数字

`余额` = 钱包读数（`$79.19`，冻结额另标）。它没有总量，所以不画百分比。

## 模型能力（图片 / 思考 / 上下文）

站点 `/v1/models` 只给 id 和显示名。**是否支持图片、是否思考、上下文多长、官方价格**，插件从 magpie 自己的 models.dev 目录（`<cache>/magpie/models.json`）按 id 补齐——和你自建的 provider 用的是同一份数据：

- 优先用站点 `/v1/models` 里 `owned_by` 指向的厂商（`openai` / `xai` / `zhipu`→`zai` …），其次按内置的厂商优先顺序，最后任意一个知道这个 id 的厂商；
- 目录里没有的 id 就保持“未知”：不编造能力，也不编造上下文；
- 价格用的是 models.dev 的官方价，站点分组倍率（例如 ×0.14）不体现在这里；
- 目录文件读一次缓存 60 秒，文件变了会重读；文件不存在或读坏，就当作“未知”，不影响其他功能。

## 数据来源

| 用途 | 请求 |
| --- | --- |
| 登录 | `POST /api/v1/auth/login` |
| 续期 | `POST /api/v1/auth/refresh` |
| 账号 / 余额 | `GET /api/v1/auth/me` |
| 签到 | `GET` + `POST /api/v1/activity/checkin` |
| 站点开关（人机验证） | `GET /api/v1/settings/public` |
| 每个密钥的模型 | `GET /v1/models`（Bearer 该密钥） |
| 对话 | `POST /v1/chat/completions`（Bearer 选中的密钥） |

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `YYDS_ORIGIN` | 换一个站点主机（镜像 / 测试用），默认 `https://www.yydsapi.uno` |

## 开发

```sh
npm test        # node --test tests/*.test.mjs，73 项
```

设计说明见 [docs/architecture.md](docs/architecture.md)。

## 已知限制

- 站点的签到 / 登录如果开了人机验证，插件不解答：签到返回 `captcha` 并让人去网站，登录请改用粘贴会话。
- 模型列表只有 id 和显示名，站点不报上下文长度；已知的几个写在 `src/constants.mjs` 的 `KNOWN_MODELS`，其余交给 magpie 自己的知识库。
- 密钥是插件级设置：同一台 magpie 上如果登录了两个只因API 账号，它们共用同一份 `keys`（余额和签到仍各算各的）。
- 页面上保存密钥会让 magpie 重载插件宿主（其它插件会跟着重启一下），这是 magpie 的 options 机制。
- 不会替你新建 `sk-` 密钥。
