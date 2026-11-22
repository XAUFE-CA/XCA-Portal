# Go 后端部署

Status: adopted

本文描述生产环境部署门户与 Go 认证后端的步骤、环境变量注入、发布顺序和回滚边界。本地开发与配置项说明见 [Go 后端](backend.md)，质量门禁见 [工程质量规则](engineering-quality.md)。

## 与本地开发的差异

| 项目 | 本地开发 | 生产环境 |
| --- | --- | --- |
| 依赖 | Compose 启动 PostgreSQL 与 Mailpit | 外部 PostgreSQL 与真实 SMTP 服务 |
| 数据库连接 | `sslmode=disable`，端口可改为 `5433` 等空闲端口 | `sslmode=verify-full`，使用数据库 CA |
| 邮件 | Mailpit，`SMTP_TLS_MODE=none` | 邮件服务商，`implicit` 或 `starttls`，需要凭据 |
| 来源 | `http://localhost:4100` | HTTPS 公网来源，与浏览器地址完全一致 |
| 代理 | `TRUSTED_PROXY_CIDRS` 为回环地址 | Nuxt 所在主机的精确地址 |
| 密钥 | 本机生成后写入 `.env` | 由密钥管理或部署平台注入进程环境 |
| 进程 | `go run ./cmd/api` | 受监管的二进制与 Nuxt Node 服务 |

Compose 只用于本地开发，不用于生产部署。

## 本地值是怎么来的

本地 `backend/.env` 的填写方式对应生产环境的来源：

| 本地项 | 本地来源 | 生产对应 |
| --- | --- | --- |
| `POSTGRES_PORT=5433` | 启动前检查 `5432` 被其他进程占用，改选空闲端口 | 不适用，生产连接外部数据库端口 |
| `POSTGRES_PASSWORD` | 随机十六进制字符串 | 数据库管理员创建角色时设置，不进入版本控制 |
| `DATABASE_URL` | 按 `postgres://xca_dev:<密码>@127.0.0.1:5433/xca_dev?sslmode=disable` 拼装 | 生产库地址、角色、数据库名，`sslmode=verify-full` |
| `OTP_HMAC_KEY`、`RATE_LIMIT_HMAC_KEY` | 各生成 32 字节随机数据并编码为 Base64 | 由密钥管理系统生成并注入，两者必须不同 |
| `PUBLIC_ORIGIN` | 已运行 Nuxt dev 的来源 `http://localhost:4100` | 反向代理后的 HTTPS 公网来源 |
| `TRUSTED_PROXY_CIDRS` | `127.0.0.1/32,::1/128` | Nuxt 服务器的固定地址或网段 |
| `SMTP_*`、`MAIL_FROM` | 指向 Mailpit 与测试地址 | 邮件服务商主机、端口、TLS 模式、凭据和已授权发件地址 |

本地 `.env` 被 Git 忽略。生产环境不复制该文件内容，也不把真实凭据写入仓库或构建产物。

## 部署前准备

1. 准备 Linux 主机、[门户指定的 Node 版本](../../.node-version)、PostgreSQL 与可终止 TLS 的反向代理。构建主机与运行主机的操作系统和 CPU 架构保持一致，Nuxt Content 的原生模块随该平台构建。
2. 创建数据库与专用角色。角色只授予业务所需的表读写权限，迁移可使用单独的高权限连接，不在运行进程中长期保留建表权限。
3. 为数据库启用 TLS，取得 CA 证书，并把证书安装到运行主机。`DATABASE_URL` 的密码含 URL 特殊字符时必须编码。
4. 准备 SMTP 服务的提交端口、TLS 模式与凭据，确认发件地址和域名配置可以投递验证码邮件。
5. 在密钥管理中生成两个独立的 32 字节随机密钥并编码为 Base64，分别作为 `OTP_HMAC_KEY` 与 `RATE_LIMIT_HMAC_KEY`。生成方式见 [配置](backend.md#配置)。
6. 规划公网 HTTPS 来源，例如 `https://portal.example.com`。该值不能带路径，不能混用 `localhost`、`127.0.0.1` 与 `[::1]`。
7. 记录 Nuxt 服务器访问 Go API 时使用的源地址，写入 `TRUSTED_PROXY_CIDRS`。只包含部署方控制的直接代理，不使用 `0.0.0.0/0`。

## 环境变量

只通过进程环境注入，Go 服务不读取 `.env`。生产环境建议使用部署平台的环境变量或权限受限的 `EnvironmentFile`。

| 变量 | 生产值 |
| --- | --- |
| `APP_ENV` | `production` |
| `API_LISTEN_ADDR` | 回环或私网地址，例如 `127.0.0.1:8080`，不直接暴露公网 |
| `DATABASE_URL` | PostgreSQL URL，生产必须 `sslmode=verify-full` |
| `MAIL_TRANSPORT` | `smtp` |
| `SMTP_HOST` | 邮件服务商主机，不能是回环、未指定或 Mailpit 地址 |
| `SMTP_PORT` | 邮件服务商端口，显式填写，不依赖本地默认值 |
| `SMTP_TLS_MODE` | `implicit` 或 `starttls` |
| `SMTP_USERNAME`、`SMTP_PASSWORD` | 邮件服务凭据，两者同时填写 |
| `MAIL_FROM` | 已授权的发件地址 |
| `OTP_HMAC_KEY`、`RATE_LIMIT_HMAC_KEY` | 两个不同的 Base64 密钥，解码后至少 32 字节 |
| `OTP_HMAC_KEY_VERSION` | 当前密钥版本，正整数 |
| `OTP_PREVIOUS_HMAC_KEYS` | 轮换期间填写，格式为逗号分隔的 `版本:Base64密钥`；不轮换时留空 |
| `SESSION_TTL` | 会话有效期，例如 `24h`，绝对过期 |
| `PASSKEY_MANAGEMENT_ENABLED` | `false`，启用配置仅允许 `APP_ENV=test` |
| `PASSKEY_AUTHENTICATION_ENABLED` | `false`，启用配置仅允许 `APP_ENV=test` |
| `NUXT_PASSKEY_QA` | 不设置或 `false`；仅隔离测试预览可设为 `true` |
| `PUBLIC_ORIGIN` | 浏览器访问的 HTTPS 来源 |
| `TRUSTED_PROXY_CIDRS` | Nuxt 的直接地址，例如 `10.0.0.15/32` |
| `API_READ_TIMEOUT`、`API_WRITE_TIMEOUT`、`API_IDLE_TIMEOUT` | 按部署超时设置，上限 5m |
| `API_SHUTDOWN_TIMEOUT` | 滚动发布等待期限，上限 1m |
| `DEPENDENCY_TIMEOUT` | 就绪检查超时，必须小于 `API_WRITE_TIMEOUT` |
| `API_MAX_BODY_BYTES` | 1 到 10485760 字节，默认 1048576 |

`POSTGRES_PASSWORD` 只供 Compose 建库，生产环境不设置。

生产环境变量模板，`CHANGE_ME` 由密钥管理替换，文件不提交仓库：

```ini
APP_ENV=production
API_LISTEN_ADDR=127.0.0.1:8080
DATABASE_URL=postgres://xca_portal:CHANGE_ME@db.internal:5432/xca_portal?sslmode=verify-full
MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_TLS_MODE=implicit
SMTP_USERNAME=CHANGE_ME
SMTP_PASSWORD=CHANGE_ME
MAIL_FROM=no-reply@example.com
OTP_HMAC_KEY=CHANGE_ME
OTP_HMAC_KEY_VERSION=1
OTP_PREVIOUS_HMAC_KEYS=
RATE_LIMIT_HMAC_KEY=CHANGE_ME
SESSION_TTL=24h
PASSKEY_MANAGEMENT_ENABLED=false
PASSKEY_AUTHENTICATION_ENABLED=false
PUBLIC_ORIGIN=https://portal.example.com
TRUSTED_PROXY_CIDRS=10.0.0.15/32
API_READ_TIMEOUT=15s
API_WRITE_TIMEOUT=15s
API_IDLE_TIMEOUT=60s
API_SHUTDOWN_TIMEOUT=10s
DEPENDENCY_TIMEOUT=2s
API_MAX_BODY_BYTES=1048576
```

`DATABASE_URL` 中的密码含 `@`、`:`、`/` 等字符时必须做 URL 编码。

## 构建产物

门户与 Go 从同一发布提交分别构建。工具链版本和冻结安装规则见 [工程质量规则](engineering-quality.md#本地开发与共享依赖)。Go 产物用以下命令生成，CI 设置 `CGO_ENABLED=0` 和 `GOTOOLCHAIN=local`：

```sh
cd backend
bun run build
```

产物为 `backend/bin/` 下的 `api`、`migrate`、`xcactl`，Windows 文件带 `.exe` 后缀。门户从仓库根目录构建：

```sh
bun install --frozen-lockfile --linker hoisted
bun run build
```

门户产物为 `.output/`。用指定的 Node 版本运行 `node .output/server/index.mjs`，不使用 `bun run generate` 代替服务端代理。CI 的 Windows 与 Linux 候选包在同平台解包后执行 [产物检查](../../scripts/build/smoke-nitro.mjs)，验证服务端正文、构建样式、默认关闭的 QA 路由与上游不可用响应。不得跨平台混用 `.output/`。仍依赖 Git 固定提交的 Neoverse-UI 候选包不进入生产发布，须完成 [npm 发布包切换](engineering-quality.md#切换到发布包)。

构建只使用源码、锁定依赖和 Git 构建信息。`APP_ENV`、`DATABASE_URL`、`PUBLIC_ORIGIN`、SMTP、HMAC 密钥与 Passkey 开关由 Go 进程启动时读取。`NUXT_BACKEND_API`、`NUXT_PASSKEY_QA` 与 Nitro 监听地址由 Node 进程启动时注入，不写入构建环境或归档。生产运行不设置 `NUXT_PASSKEY_QA`。

## 数据库迁移

API 进程不会自动执行迁移。发布步骤先运行迁移，再让新进程接收流量：

```sh
/opt/xca/bin/migrate up
```

迁移前完成可恢复备份，并在测试库验证该版本。并发迁移依赖数据库锁。`migrate down --confirm` 只回退一个版本并删除数据表，生产不使用破坏性回退；回滚依赖应用版本切换和已验证的备份恢复。

`000001_auth` 不再修改。`000002_passkeys` 添加 Passkey 数据、管理操作效果和 OTP 认证时间列，不给已有会话补写认证时间。应用版本回滚保留新版结构。隔离测试库向下迁移前须停止新版 API；回退会删除 Passkey 凭据、挑战、操作效果和 OTP 认证时间，但保留原账户、会话及操作屏障。Passkey 管理操作保留为取消记录，避免已登记的操作标识重新生效。

如果隔离库执行过合并前的版本 `2` 或 `3`，使用新建的隔离库从最终迁移重建。不要用 `migrate force` 改写版本号来替代迁移。隔离测试库启用前先完成迁移，使用单独的数据库和浏览器来源。配置与补偿规则见 [Passkey 管理](backend.md#passkey-管理)。

Passkey 登录复用版本 `2` 的认证挑战、凭据和操作记录，不新增迁移。隔离环境可单独启用登录开关；连接同一测试数据库的实例使用相同的 RP 配置和 `RATE_LIMIT_HMAC_KEY`。规则见 [Passkey 登录](backend.md#passkey-登录)。

## 启动与监管

Go API 以专用用户运行，监听私网或回环地址。示例使用 systemd：

```ini
[Service]
User=xca
WorkingDirectory=/opt/xca/backend
EnvironmentFile=/etc/xca/backend.env
ExecStart=/opt/xca/bin/api
Restart=on-failure
NoNewPrivileges=true
```

`/etc/xca/backend.env` 权限限制为服务用户可读，内容为上文环境变量。Nuxt 作为独立服务运行，注入 `NUXT_BACKEND_API` 指向 Go 地址：

```sh
NUXT_BACKEND_API=http://127.0.0.1:8080 PORT=3000 node .output/server/index.mjs
```

反向代理终止 TLS，把公网请求转发到 Nuxt。Nuxt 再转发 `/api/v1/` 到 Go。浏览器只访问 Nuxt，Go 健康检查与业务端口只在内部网络可达。

## 反向代理与 Cookie

- `PUBLIC_ORIGIN` 必须与浏览器地址的协议、主机和端口完全一致。
- 浏览器写请求携带的 `Origin` 必须等于该值；不开放跨域凭据。
- 生产会话 Cookie 为 `__Host-xca_session`，要求 `Secure`、`HttpOnly`、`Path=/`、`SameSite=Lax` 且没有 `Domain`；只有 HTTPS 入口可用。
- 代理转发 `Set-Cookie`、`Origin` 和认证请求头，不缓存认证响应。
- Go 直接看到的来源是 Nuxt。`TRUSTED_PROXY_CIDRS` 填写 Nuxt 地址，而不是公网入口地址。

## 健康检查与发布顺序

1. 备份数据库，记录当前应用版本。
2. 在受控环境注入迁移所需环境，运行 `migrate up`。
3. 启动新 Go API，等待 `/readyz` 返回 `200`。失败时不接入流量。
4. 启动新 Nuxt 版本，切换反向代理。
5. 验证 `/healthz`、`/readyz`、未登录会话、邀请登录、退出和 Cookie 属性。
6. 保留上一版本二进制与构建产物。回滚只切换应用版本，不依赖数据库回退。

`/healthz` 不访问数据库，用于判断进程存活；`/readyz` 检查 PostgreSQL，失败返回 `503`。探针不暴露公网，由部署平台的内部检查调用。

## 首个账户与邀请

邀请由 `xcactl` 生成，读取同一份进程环境，生产操作额外要求 `--allow-production`：

```sh
/opt/xca/bin/xcactl create --allow-production --email member@example.com --login member-name --display-name Member --ttl 168h
```

令牌只在标准输出显示一次，数据库只保存摘要。不得写入公共日志或命令历史；通过安全渠道交付目标成员。`show` 与 `revoke` 使用邀请 UUID。

## 密钥轮换

1. 在全部实例的环境中加入新版本密钥，旧版本保留在 `OTP_PREVIOUS_HMAC_KEYS`。
2. 确认实例重启并完成就绪检查。
3. 把 `OTP_HMAC_KEY_VERSION` 切换到新版本并重启。
4. 等待旧流程超过验证码有效期与会话期限后，再从 `OTP_PREVIOUS_HMAC_KEYS` 移除旧密钥。

缺少仍在使用的密钥时服务拒绝启动。轮换过程与配置约束见 [配置](backend.md#配置)。

## 运行检查

- 日志使用结构化格式并输出到标准错误，不记录数据库连接串、密钥、验证码或请求正文。
- 监控 `/readyz` 失败、邮件投递失败和认证限流错误。
- 定期验证数据库备份可恢复；应用版本回滚与数据库恢复分别演练。
- 证书到期前更新 TLS；`PUBLIC_ORIGIN` 变更须同步更新环境变量并重启相关进程。
