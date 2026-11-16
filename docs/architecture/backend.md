# Go 后端

Status: adopted

`backend/` 是独立 Go 模块。HTTP 服务只提供 `/healthz` 和 `/readyz`，后者通过 `pgxpool` 检查 PostgreSQL。邀请、验证码、限流和邮件投递位于内部认证用例，尚未注册认证 HTTP 路由。浏览器会话与门户登录尚未实现。[OpenAPI 定义](../../backend/api/openapi.yaml) 描述完整 1A 接口，不能将接口定义视为已开放功能。

## 目录与职责

```text
backend/
  api/                 OpenAPI 定义及生成的 TypeScript 类型
  cmd/api/             进程入口、信号处理与关闭
  cmd/migrate/         受控数据库迁移入口
  cmd/xcactl/          受控邀请管理命令
  internal/config/     环境变量解析和启动校验
  internal/auth/       验证码、限流、邀请激活事务和投递容量
  internal/invitation/ 邀请校验、持久化和管理规则
  internal/mail/       可替换的邮件传输与 SMTP
  internal/httpapi/    探针、请求大小限制和响应
  migrations/          版本化 SQL、迁移入口和 PostgreSQL 集成测试
  tools/               独立检查与接口类型生成入口
  compose.yaml         本地 PostgreSQL 与 Mailpit
  .env.example         不含凭据的配置示例
  go.mod, go.sum       Go 工具链和依赖
  package.json, bun.lock  接口检查工具和锁文件
```

`GET /healthz` 不访问数据库。`GET /readyz` 在依赖超时内检查 PostgreSQL，失败时返回 `503 service_unavailable`，不返回连接信息。服务默认只监听 `127.0.0.1:8080`。部署入口决定探针访问范围，不默认经公网代理暴露。

服务设置请求头、读取、写入和空闲超时。已知正文长度超过上限时直接返回 `413`，其余请求通过 `http.MaxBytesReader` 限制实际读取。探针不读取正文，未知长度的探针请求不保证返回 `413`。退出时等待配置的关闭期限；日志使用结构化格式，不记录连接字符串、密钥或请求正文。

认证处理器必须在解码前保留受限读取器。准备执行业务的请求必须完成单个 JSON 值及末尾 EOF 验证，包括尾部空白；读取超限时将 `*http.MaxBytesError` 映射为 `413 invalid_request`。在全部验证完成前不得写入数据库、发送邮件或变更会话。在读到上限前已被拒绝的请求不必为了返回 `413` 而消费剩余正文。

认证处理器测试必须覆盖已知和未知长度、恰好达到上限、超限及合法 JSON 后的超限空白。至少使用真实 HTTP/1.1 chunked 请求验证未知长度，并核对错误响应和无业务副作用。

## 配置

服务只读取进程环境变量，不自动读取 `.env`。复制 [配置示例](../../backend/.env.example) 到同目录 `.env` 后填写非生产数据库密码、数据库地址和两个独立密钥。`.env` 被 Git 忽略，不提交真实凭据。`DATABASE_URL` 使用 PostgreSQL URL，必须包含用户名、密码、主机与数据库名；密码中的 URL 特殊字符需编码。

`OTP_HMAC_KEY` 与 `RATE_LIMIT_HMAC_KEY` 分别使用至少 32 字节的独立随机数据并编码为 Base64。配置校验拒绝相同、过短、格式错误或单字节重复的值，但无法证明随机性；生产密钥必须由受控密钥管理生成和注入。开发数据库密码可使用 URL 安全字符。`POSTGRES_PASSWORD` 只供 Compose 创建数据库，必须与 `DATABASE_URL` 中的密码一致。

`APP_ENV` 可为 `development`、`test` 或 `production`。生产环境要求 HTTPS 的 `PUBLIC_ORIGIN`、数据库 `sslmode=verify-full`、有凭据的 SMTP 及 `implicit` 或 `starttls`，拒绝 Mailpit、回环 SMTP 地址和信任所有地址的代理网段。设置只能检查配置，无法识别伪装成正式 SMTP 的测试服务；生产部署仍须核对发件服务和证书。SMTP 支持隐式 TLS 和 STARTTLS，不回退为明文。会话期限、同源地址与可信代理尚未接入公开认证路由。

`OTP_HMAC_KEY_VERSION` 是当前密钥的正整数版本，默认值为 `1`。轮换时通过 `OTP_PREVIOUS_HMAC_KEYS` 注入以逗号分隔的 `版本:Base64密钥`，版本和密钥均不得重复，也不得与限流密钥相同。内部认证服务启动时检查未使用且未过期流程所需的版本，缺少密钥则拒绝启动。多实例轮换应先在所有实例加入新旧密钥，再切换当前版本，等待旧流程全部过期后才能移除旧密钥。

## 本地启动

准备 Go、Bun、Docker Engine 和 Compose。端口必须在启动前检查，不能终止现有进程或自动换端口。开发默认使用 PostgreSQL `127.0.0.1:5432`、Mailpit SMTP `127.0.0.1:2525`、Mailpit Web `127.0.0.1:8025` 与 Go `127.0.0.1:8080`。门户和浏览器测试端口仍分别为 `4100` 和 `4102`。Compose 项目名为 `xca-portal-backend-dev`；启动前核对同名项目、容器与卷，不接管其他工作区的资源。

在 `backend/` 填写 `.env`，使用无引号、无换行的 `NAME=value`。本地数据库密码使用字母或数字，并填入 `DATABASE_URL=postgres://xca_dev:<密码>@127.0.0.1:5432/xca_dev?sslmode=disable`。生成两个不同的 32 字节随机密钥后填入示例中的密钥项。`MAIL_FROM` 使用本地测试身份，不使用真实个人邮箱。

`SMTP_PORT` 同时指定 Compose 中 Mailpit 的宿主端口和 Go 进程连接的端口，容器内端口保持 `1025`。该约定只适用于连接本地 Mailpit 的开发配置。旧 `.env` 不会随示例更新，修改端口时须同步更新实际 `.env` 并重新载入进程环境。生产环境应显式配置邮件服务商的端口，不依赖本地默认值。

可在可信终端用以下命令分别生成密钥。输出属于敏感数据，不提交、不粘贴到公共记录。

```sh
bun -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64") + "\n")'
```

Windows PowerShell：

```powershell
Get-NetTCPConnection -LocalPort 8080,5432,2525,8025,4100,4102 -ErrorAction SilentlyContinue
docker compose ls -a
Get-Content .env | Where-Object { $_ -match '^[A-Z_][A-Z_0-9]*=' } | ForEach-Object {
  $name, $value = $_.Split('=', 2)
  [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}
docker compose --env-file .env up -d --wait
go run ./cmd/api
```

Linux：

```sh
ss -tan
ss -Btn
docker compose ls -a
set -a
. ./.env
set +a
docker compose --env-file .env up -d --wait
go run ./cmd/api
```

PowerShell 端口检查包含 `Bound`、监听和已建立连接，不能只检查监听状态。Linux 的 `ss -Btn` 检查已绑定但尚未活动的 TCP 套接字。使用自定义端口时检查实际配置的端口，检查结果不能预留端口。Linux 的 `.env` 值必须使用可被 shell 原样读取的字符。停止本项目开发依赖使用 `docker compose --env-file .env down`，默认保留数据库卷；不得清理其他项目的容器或卷。

Compose 固定镜像版本和摘要，数据库使用独立持久卷，两个服务分别进行健康检查，不存在相互启动依赖。升级时审阅上游安全公告、更新版本及摘要，并验证启动、健康检查、停机和现有数据兼容性；PostgreSQL 主版本升级还须规划数据迁移和恢复。Compose 仅供开发，不用于生产部署。

## 数据库与邀请

`migrations/` 使用 `golang-migrate` 的 PostgreSQL 驱动，迁移版本和中断状态保存在数据库中。发布步骤在新进程接收流量前运行 `go run ./cmd/migrate up`，API 进程不会自动执行迁移。并发迁移依赖数据库锁。迁移失败后检查备份、数据库结构和版本状态，再由受控管理员修复；不能用强制重置版本掩盖中断。

`go run ./cmd/migrate down --confirm` 只回退一个版本，会删除当前迁移中的数据表。生产数据恢复依赖事先验证的备份，不依赖破坏性回退。邀请命令读取同一份进程环境，生产环境的所有操作额外要求 `--allow-production`，数据库访问权限和命令执行环境由部署方控制。

```sh
go run ./cmd/xcactl create --email member@example.invalid --login member-name --display-name Member --ttl 168h
go run ./cmd/xcactl show --id INVITATION_ID
go run ./cmd/xcactl revoke --id INVITATION_ID
```

邀请默认有效 7 天，可指定 `1us` 至 `8760h` 的有效期。邮箱去除首尾空白并转换为小写，登录名限制为小写字母、数字、连字符和下划线，首字符必须为字母或数字，`guest` 等系统名称被保留。显示名不能包含控制字符。邀请凭证由安全随机数生成，创建成功后仅在标准输出显示一次，数据库只保存摘要。不得将该输出写入公共日志或命令历史。

数据库包含 `users`、`invitations`、`email_challenges`、`sessions` 和 `auth_rate_limits`。账户的邮箱与登录名分别唯一，有效邀请的邮箱与登录名分别由部分唯一索引保护。过期邀请的占位在新邀请创建时释放；撤销不改变已激活账户。验证码验证锁定流程，在同一事务中消费邀请、创建账户并调用会话操作回调。回调失败时整笔事务回滚；本批次没有签发会话的实现。

## 内部验证码与投递

验证码为 6 位数字，有效期 10 分钟，每个流程最多允许 5 次错误尝试。相同邮箱重发至少间隔 60 秒，邮箱和来源地址分别限制为每个 15 分钟固定窗口最多 3 次和 30 次。固定窗口交界可能连续使用相邻两个窗口的额度，来源地址限制不是校园网络的唯一限制。计数和重发间隔在 PostgreSQL 中原子更新，限流主体仅保存独立密钥生成的摘要。`CleanExpiredRateLimits` 只删除过期记录，目前没有自动清理调度。

真实和不可验证流程均先通过相同限流并创建不可预测的流程标识。验证码摘要使用绑定流程标识和密钥版本的 HMAC；重新申请会使同邮箱旧流程失效。不可验证流程不发送邮件，也不能成功验证。未注册的协议适配器只使用连接的直接来源地址，不信任请求提供的转发头；正式开放前必须完成可信代理解析及第三批的会话与请求安全检查。

邮件由进程内有界容量限制并在事务提交后异步发送。容量检查发生在账户资格判断之前，真实和不可验证流程在创建成功后均占用容量 15 秒，服务关闭时提前取消。该规则降低通过后续容量状态区分流程的风险，也限制突发吞吐量。SMTP 接受邮件后才将流程标记为可验证；发送失败、进程重启或邮件接受后确认写入失败时，该邮件可能丢失或不能使用，依赖用户在限流允许后重新申请。该进程内机制没有持久投递保证，邮件正文和验证码不进入日志。

## 独立检查

在 `backend/` 运行：

```sh
bun tools/check.mjs
bun install --frozen-lockfile
bun run api:check
bun run test:integration
```

Go 检查依次执行 `gofmt`、`go vet ./...`、`go test ./...`、`go build ./...` 和固定版本的 `staticcheck`。安装受支持的 C 工具链后使用 `bun tools/check.mjs -race` 增加竞争检测。集成测试入口创建独立 Compose 项目和测试数据库，检查固定回环端口 `15432`、`12526`、`18026`，不连接开发数据库或外部邮箱。测试结束只删除该次创建的资源。Windows 和 Linux 均需要 Docker Compose、Go、Bun 及可用于 Go 竞争检测的 C 编译器。

`bun run api:generate` 从 OpenAPI 生成 TypeScript，`api:check` 校验定义、引用、生成结果与类型。探针测试按 OpenAPI 校验真实处理器响应。未注册的验证码申请适配器另有响应与安全检查，其测试不代表公开认证路由已经启用。

## 接口安全约定

OpenAPI 是两端接口字段与公开错误的唯一来源。认证端点的实现须按定义统一不可枚举的 `202`、无身份时的 `identity: null`、验证码失败和限流错误，以及无正文的 `204` 注销响应。网络错误不得当作游客或注销成功。

浏览器写请求须提供与 `PUBLIC_ORIGIN` 一致的 `Origin`，只接受 JSON，不开放跨域凭据 CORS。生产会话使用 `__Host-` Cookie，要求 `Secure`、`HttpOnly`、`Path=/`、`SameSite=Lax` 且没有 `Domain`。认证响应和错误均禁止缓存。这些是尚待实现和验证的接口约束，不代表服务已经设置 Cookie 或执行 CSRF 检查。
