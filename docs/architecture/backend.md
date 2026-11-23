# Go 后端

Status: adopted

`backend/` 是独立 Go 模块。服务提供健康检查接口与门户自有认证接口；邀请、验证码、限流、邮件和会话分别由内部用例与 HTTP 适配器处理。统一身份、应用会话与未来 OIDC 的取舍见 [统一身份决策](../adr/0002-unified-identity.md)，生产部署步骤见 [Go 后端部署](backend-deployment.md)。

## 目录与职责

```text
backend/
  api/                 OpenAPI 定义及生成的 TypeScript 类型
  cmd/api/             进程入口、信号处理与关闭
  cmd/migrate/         受控数据库迁移入口
  cmd/xcactl/          受控邀请管理命令
  internal/config/     环境变量解析和启动校验
  internal/auth/       认证用例共享的身份类型与错误
    emailcode/         邮件验证码、邀请激活与投递
    passkey/           Passkey 注册、登录与凭据管理
    ratelimit/         邮件验证码与 Passkey 共用的限流计数
    session/           会话持久化、操作取消与事务补偿
  internal/invitation/ 邀请校验、持久化和管理规则
  internal/mail/       可替换的邮件传输与 SMTP
  internal/httpapi/    按完整路径分发 HTTP 请求、健康检查及 OpenAPI 接口测试
    authhttp/          邮件 OTP、会话与操作取消的 HTTP 处理
    passkeyhttp/       Passkey 管理与登录的 HTTP 处理
    internal/transport/  共用响应、会话 Cookie 与可信代理来源地址解析
  migrations/          版本化 SQL、迁移入口和 PostgreSQL 集成测试
  tools/               开发启动、独立检查与接口类型生成入口
  compose.yaml         本地 PostgreSQL 与 Mailpit
  .env.example         不含凭据的配置示例
  go.mod, go.sum       Go 工具链和依赖
  package.json, bun.lock  接口检查工具和锁文件
```

`GET /healthz` 返回进程运行状态，不访问数据库。`GET /readyz` 在依赖超时内检查 PostgreSQL，失败时返回 `503 service_unavailable`，不返回连接信息。两者属于健康检查接口；服务默认只监听 `127.0.0.1:8080`，部署入口决定其访问范围，不默认经公网代理暴露。

服务设置请求头、读取、写入和空闲超时。已知正文长度超过上限时直接返回 `413`，其余请求通过 `http.MaxBytesReader` 限制实际读取。健康检查接口不读取正文，未知长度的健康检查请求不保证返回 `413`。退出时等待配置的关闭期限；日志使用结构化格式，不记录连接字符串、密钥或请求正文。

认证处理器必须在解码前保留受限读取器。准备执行业务的请求必须完成单个 JSON 值及末尾 EOF 验证，包括尾部空白；读取超限时将 `*http.MaxBytesError` 映射为 `413 invalid_request`。在全部验证完成前不得写入数据库、发送邮件或变更会话。在读到上限前已被拒绝的请求不必为了返回 `413` 而消费剩余正文。

认证处理器测试必须覆盖已知和未知长度、恰好达到上限、超限及合法 JSON 后的超限空白。至少使用真实 HTTP/1.1 chunked 请求验证未知长度，并核对错误响应和无业务副作用。

## 配置

服务只读取进程环境变量，不自动读取 `.env`。复制 [配置示例](../../backend/.env.example) 到同目录 `.env` 后填写非生产数据库密码、数据库地址和两个独立密钥。`.env` 被 Git 忽略，不提交真实凭据。`DATABASE_URL` 使用 PostgreSQL URL，必须包含用户名、密码、主机与数据库名；密码中的 URL 特殊字符需编码。

`OTP_HMAC_KEY` 与 `RATE_LIMIT_HMAC_KEY` 分别使用至少 32 字节的独立随机数据并编码为 Base64。配置校验拒绝相同、过短、格式错误或单字节重复的值，但无法证明随机性；生产密钥必须由受控密钥管理生成和注入。开发数据库密码可使用 URL 安全字符。`POSTGRES_PASSWORD` 只供 Compose 创建数据库，必须与 `DATABASE_URL` 中的密码一致。

`APP_ENV` 可为 `development`、`test` 或 `production`。生产环境要求 HTTPS 的 `PUBLIC_ORIGIN`、数据库 `sslmode=verify-full`、有凭据的 SMTP 及 `implicit` 或 `starttls`，拒绝 Mailpit、回环 SMTP 地址和信任所有地址的代理网段。设置只能检查配置，无法识别伪装成正式 SMTP 的测试服务；生产部署仍须核对发件服务和证书。SMTP 支持隐式 TLS 和 STARTTLS，不回退为明文。

`OTP_HMAC_KEY_VERSION` 是当前密钥的正整数版本，默认值为 `1`。轮换时通过 `OTP_PREVIOUS_HMAC_KEYS` 注入以逗号分隔的 `版本:Base64密钥`，版本和密钥均不得重复，也不得与限流密钥相同。内部认证服务启动时检查未使用且未过期流程所需的版本，缺少密钥则拒绝启动。多实例轮换应先在所有实例加入新旧密钥，再切换当前版本，等待旧流程全部过期后才能移除旧密钥。

`SESSION_TTL` 默认 24 小时，按创建时间绝对过期，不因查询延长。`PUBLIC_ORIGIN` 必须与浏览器访问门户的来源完全一致。`TRUSTED_PROXY_CIDRS` 仅包含部署方控制的直接代理；直接连接不在清单中时忽略请求提供的转发地址。可信代理链从直接连接一侧向外解析，遇到首个不可信地址即停止。生产环境不接受覆盖全部地址的代理网段。

Nuxt 的服务端运行时配置 `NUXT_BACKEND_API` 指定 Go 上游，默认 `http://127.0.0.1:8080`，不暴露给客户端。转发路由位于 `server/api/v1/[...path].ts`，只接受以 `/api/v1/` 开头的路径，其余目标返回 `503`。Nuxt 转发 `/api/v1/` 的方法、正文、`Origin` 和 Cookie，保留上游 `Set-Cookie`；请求仅转发所需头部，丢弃客户端提供的代理头，并以直接连接地址重建 `X-Forwarded-For`。Go 信任 Nuxt 地址前必须在 `TRUSTED_PROXY_CIDRS` 中明确配置。Nuxt 前另有入口代理时，此规则保守地将入口代理作为来源，部署方须核验限流粒度，不能直接信任浏览器提供的来源头。上游网络故障返回 `503 service_unavailable`，不会伪装成游客。

## 本地启动

准备 Go、Bun、Docker Engine 和 Compose。端口必须在启动前检查，不能终止现有进程或自动换端口。开发默认使用 PostgreSQL `127.0.0.1:5432`、Mailpit SMTP `127.0.0.1:2525`、Mailpit Web `127.0.0.1:8025` 与 Go `127.0.0.1:8080`。门户和浏览器测试端口仍分别为 `4100` 和 `4102`。PostgreSQL 的宿主机端口由 `POSTGRES_PORT` 指定，默认 `5432`；端口被占用时改为其他空闲端口并同步修改 `DATABASE_URL`，容器内端口仍是 `5432`。Compose 项目名为 `xca-portal-backend-dev`；启动前核对同名项目、容器与卷，不接管其他工作区的资源。

在 `backend/` 填写 `.env`，使用无引号、无换行的 `NAME=value`。本地数据库密码使用字母或数字，并填入 `DATABASE_URL=postgres://xca_dev:<密码>@127.0.0.1:<POSTGRES_PORT>/xca_dev?sslmode=disable`。生成两个不同的 32 字节随机密钥后填入示例中的密钥项。`MAIL_FROM` 使用本地测试身份，不使用真实个人邮箱。仓库根目录的 `bun run backend:dev` 读取该文件，依次启动 Compose 依赖、执行迁移并启动 API。`bun run backend:down` 停止并移除该项目的 PostgreSQL 与 Mailpit 容器及其网络，默认保留数据库卷。

本地由 Nuxt 转发到 Go 时，可将 `TRUSTED_PROXY_CIDRS` 设为 `127.0.0.1/32,::1/128`；仅在这些回环地址上的代理进程均可信时使用。`PUBLIC_ORIGIN` 按浏览器实际访问的协议、主机和端口填写，不能将 `localhost`、`127.0.0.1` 和 `[::1]` 混用。浏览器测试预览使用其他端口时必须同步调整该值。

`SMTP_PORT` 同时指定 Compose 中 Mailpit 的宿主机端口和 Go 进程连接的端口，容器内端口保持 `1025`。该约定只适用于连接本地 Mailpit 的开发配置。旧 `.env` 不会随示例更新，修改端口时须同步更新实际 `.env` 并重新载入进程环境。生产环境应显式配置邮件服务商的端口，不依赖本地默认值。

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
go run ./cmd/migrate up
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
go run ./cmd/migrate up
go run ./cmd/api
```

PowerShell 端口检查包含 `Bound`、监听和已建立连接，不能只检查监听状态。Linux 的 `ss -Btn` 检查已绑定但尚未活动的 TCP 套接字。使用自定义端口时检查实际配置的端口，检查结果不能预留端口。Linux 的 `.env` 值必须使用可被 shell 原样读取的字符。停止本项目开发依赖使用 `docker compose --env-file .env down`，默认保留数据库卷；不得清理其他项目的容器或卷。

Compose 固定镜像版本和摘要，数据库使用独立持久卷，两个服务分别进行健康检查，不存在相互启动依赖。升级时审阅上游安全公告、更新版本及摘要，并验证启动、健康检查、停机和现有数据兼容性；PostgreSQL 主版本升级还须规划数据迁移和恢复。Compose 仅供开发，不用于生产部署。

## 数据库与邀请

`migrations/` 使用 `golang-migrate` 的 PostgreSQL 驱动，迁移版本和中断状态保存在数据库中。发布步骤在新进程接收流量前运行 `go run ./cmd/migrate up`，API 进程不会自动执行迁移。并发迁移依赖数据库锁。迁移失败后检查备份、数据库结构和版本状态，再由受控管理员修复；不能用强制重置版本掩盖中断。失败输出在固定提示后附带底层原因，例如 `no migration found for version 3` 表示数据库记录的版本已不存在于 `migrations/`；连接串与密码在输出前被替换，不打印凭据。

`go run ./cmd/migrate down --confirm` 只回退一个版本，会删除当前迁移中的数据表。生产数据恢复依赖事先验证的备份，不依赖破坏性回退。邀请命令读取同一份进程环境，生产环境的所有操作额外要求 `--allow-production`，数据库访问权限和命令执行环境由部署方控制。

```sh
go run ./cmd/xcactl create --email member@example.invalid --login member-name --display-name Member --ttl 168h
go run ./cmd/xcactl show --id INVITATION_ID
go run ./cmd/xcactl revoke --id INVITATION_ID
```

邀请默认有效 7 天，可指定 `1us` 至 `8760h` 的有效期。邮箱去除首尾空白并转换为小写，登录名限制为小写字母、数字、连字符和下划线，首字符必须为字母或数字，`guest` 等系统名称被保留。显示名不能包含控制字符。邀请凭证由安全随机数生成，创建成功后仅在标准输出显示一次，数据库只保存摘要。不得将该输出写入公共日志或命令历史。

账户的邮箱与登录名分别唯一，有效邀请的邮箱与登录名分别由部分唯一索引保护。过期邀请的占位在新邀请创建时释放；撤销不改变已激活账户。验证码验证锁定流程，在同一事务中消费邀请、创建账户并写入会话摘要。任一步失败均回滚，事务提交后才设置 Cookie。

每次登录生成独立随机凭证，同一账户允许多个会话。数据库保存会话凭证的 SHA-256 摘要，不保存原文。邮件 OTP 登录与邀请激活签发会话时，在同一事务写入 `otp_verified_at`；迁移前的会话保留空值，不补写认证时间。查询更新最近使用时间，不延长会话或 OTP 认证时间。停用账户使全部会话不能通过校验。门户注销只撤销当前会话，不影响其他设备的会话或其他应用的本地会话。

浏览器每次验证码验证或注销必须使用新的 `X-XCA-Auth-Operation` 随机 UUID。验证事务及注销事务在 `auth_operations` 记录操作标识，主键锁保证与 `POST /api/v1/auth/operations/abandon` 串行化。取消屏障先到时，迟到的原操作无法提交。原验证先提交时，屏障会在确认前撤销它签发的会话；原注销先提交时，屏障等其结束后才返回。屏障异常时，客户端必须阻止新的身份写入，不能用单次 Session 查询替代。客户端只在同源存储中暂存随机操作标识，不存放 Session Cookie、OTP 或其他认证凭证。多个同源标签页的写入使用浏览器 Web Locks 串行化，缺少该能力时身份写入默认失败。生产部署应在 HTTPS 下验证这些能力及 Cookie 响应顺序。

`000002_passkeys` 增加 `passkey_credentials`、`passkey_challenges`、`passkey_operation_effects` 和账户的可空 `webauthn_user_handle`。注册挑战关联账户和会话。凭据按 RP ID 与原始凭据 ID 唯一，撤销后仍占用该标识。操作效果表为已提交的管理操作保留补偿依据。注册排除查询使用覆盖有效及已撤销凭据的索引。

## Passkey 管理

`PASSKEY_MANAGEMENT_ENABLED` 默认 `false`，只允许在隔离的 `APP_ENV=test` 环境显式设为 `true`。关闭时四个管理接口返回 `404`，不影响独立的登录开关。门户不提供 Passkey 交互或可用性声明。

启用任一 Passkey 开关时必须显式设置 `WEBAUTHN_RP_ID` 与 `WEBAUTHN_RP_NAME`。RP ID 是浏览器来源的主机名或其有效域名后缀，不能是公共后缀或 IP 地址。`PUBLIC_ORIGIN` 使用浏览器序列化的来源，不带路径或显式默认端口。只支持 HTTPS 或本机 `http://localhost`，后者使用 `localhost` 作为 RP ID。即使两个开关均关闭，只要填写了任一 RP 参数，启动时也校验两者。

| 方法 | `/api/v1/auth/passkeys` 下的路径 | 成功结果 |
| --- | --- | --- |
| `POST` | `/registration/options` | `200`，返回 `flow_id` 与浏览器注册选项 `publicKey` |
| `POST` | `/registration/verify` | `201`，返回新凭据的公开记录 |
| `GET` | 无 | `200`，仅列出当前账户在当前 RP 下的有效凭据 |
| `POST` | `/revoke` | `204`，软撤销当前账户的指定凭据 |

所有管理接口要求有效会话和正常账户。查询不要求近期 OTP，仅返回服务端生成的记录 ID、可空名称、创建时间、可空最近使用时间及备份标志。撤销使用公开记录 ID，不存在、已撤销、其他 RP 或其他账户的凭据统一返回 `404 credential_not_found`。保留 OTP 登录，因此允许撤销最后一项凭据。

绑定与撤销在取得数据库锁后和提交前检查 `otp_verified_at`。`PASSKEY_RECENT_OTP_WINDOW` 默认 `5m`，允许 `1s`–`15m`；空值、未来时间或达到窗口上限均返回 `403 recent_otp_required`。通过现有 OTP 流程建立新会话，查询会话不会延长窗口。写请求必须带与配置完全一致的 `Origin`，只接受单一 JSON 对象并受全局正文上限约束；不开放跨域凭据。查询接受浏览器省略 `Origin`，但拒绝提供的其他来源。

注册选项使用 [go-webauthn v0.18.2](https://github.com/go-webauthn/webauthn/releases/tag/v0.18.2)，要求用户验证和可发现凭据，请求无认证器证明，不限定认证器类型。首次生成的 32 字节账户句柄在行锁下写入，不随账户名称更新。排除列表包含该账户同一 RP 下所有已登记的凭据，包括已撤销的凭据。服务端存储库验证后的凭据 ID、公钥、签名计数、用户验证及备份标志，不保存认证器识别数据或原始证明。

注册挑战自创建起有效 2 分钟。服务端按流程 ID、挑战类型、RP、来源、账户、会话和存储版本读取并锁定挑战，使用协议库解析响应与验证挑战、来源、RP ID、用户在场、用户验证和公钥。挑战消费、凭据写入、唯一约束和操作效果在同一事务提交。数据库故障或验证失败不消费挑战，不写入有效凭据。此阶段不依赖证明辨识设备型号。

### 管理操作取消

验证注册和撤销要求新的随机 `X-XCA-Auth-Operation` UUID。响应丢失时，向既有 `POST /api/v1/auth/operations/abandon` 提交此标识，等待屏障确认后再进行新的写入。若管理事务未提交，先到的取消记录阻止之后写入；若事务已持有该操作锁，屏障等待其提交或回滚。

若注册先提交，屏障只接受发起操作的 Cookie，并在返回 `204` 时通过 `X-XCA-Passkey-Operation-Outcome: registration_revoked` 确认服务端凭据已软撤销。认证器中的凭据无法被服务端删除，可能保留不可用条目。若撤销先提交，响应头为 `revocation_committed`，不会恢复凭据。缺少有效管理证明或开关已关闭时不确认管理效果。`204` 无该头表示没有管理效果可报告，不表示已提交的撤销被逆转。操作标识只交给发起请求的调用方，不记入日志。

## Passkey 登录

`PASSKEY_AUTHENTICATION_ENABLED` 默认 `false`，只允许在隔离的 `APP_ENV=test` 环境显式启用。它与管理开关独立，共用 RP 和来源配置。关闭时两个登录接口在处理请求前返回 `404 invalid_request`。门户和终端没有 Passkey 登录交互。

| 方法 | `/api/v1/auth/passkeys/authentication` 下的路径 | 成功结果 |
| --- | --- | --- |
| `POST` | `/options` | `200`，返回 `flow_id` 和 `publicKey`，不接收邮箱或账户 |
| `POST` | `/verify` | `200`，返回与 OTP 登录相同的 `identity` 并设置会话 Cookie |

登录配置要求验证用户，不发送允许凭据列表，不使用条件式触发。PostgreSQL 保存 2 分钟的随机挑战和协议状态，挑战绑定 RP 与来源，不记录账户或会话。服务端按 32 字节账户句柄寻找正常账户，再按账户、RP ID 和原始凭据 ID 读取有效凭据。WebAuthn 库使用保存的公钥验证挑战、来源、RP ID、用户在场、用户验证和签名。不区分未知凭据、句柄不匹配、凭据撤销、账户停用和无效断言，统一返回 `400 invalid_or_expired_authentication`。数据库故障返回 `503 service_unavailable`。

凭据行锁下比较签名计数。两个计数均为零时允许登录，支持不维护计数的同步 Passkey；递增时保存新值。旧值非零时，持平、回退或归零均拒绝当前断言，不覆盖较高计数、不自动停用凭据。受影响的用户可改用 OTP。备份资格不变，备份状态只取自验签后的断言；登录不会初始化凭据的用户验证标记。

登录事务按操作、认证挑战、账户、凭据的顺序加锁。管理写入先锁会话和账户，再锁凭据；登录不锁已有会话。凭据状态更新、挑战消费、新会话和操作记录同时提交，提交失败不设置 Cookie。Passkey 会话的 `otp_verified_at` 保持空值，不能用来满足绑定或撤销所需的近期 OTP。

验证要求新的随机 `X-XCA-Auth-Operation` UUID。登录复用 OTP 的 `verify` 操作类型，取消先到时阻止写入，登录先提交时撤销它签发的会话。响应丢失时等待原有取消屏障确认，不重放挑战，不以会话查询代替屏障。已验证断言的计数和备份状态不会因会话撤销而回退。管理操作的补偿响应头不用于登录。

### 匿名限流

| 约束 | 选项 | 验证 |
| --- | --: | --: |
| 每来源、每分钟固定窗 | 10 | 20 |
| 全局每分钟固定窗 | 160 | 320 |
| 全局未完成挑战 | 256 | — |
| 单个有效挑战的提交 | — | 5 |

来源由可信代理规则计算，来源额度使用 HMAC 摘要，不按账户或凭据 ID 分配额度。被来源拦截的请求不消耗全局额度。验证额度在断言事务之前单独提交，失败或回滚不退还尝试次数。超限返回 `429 rate_limited` 与 `Retry-After`。固定窗交界可连续使用相邻两窗额度，但不能越过未完成挑战的全局上限。新建选项时清理过期认证挑战，认证请求分批使用数据库锁清理过期的认证限流记录。

隔离测试环境提供 `/auth/passkey` 浏览器入口。`app/features/auth/passkey/` 包含浏览器适配 `browser.ts` 和流程协调 `workflow.ts`，`app/features/auth/session/` 管理应用级身份状态与认证请求。测试页面要求服务端私有配置 `NUXT_PASSKEY_QA=true`，否则服务端中间件和可用性接口均返回 `404`。该开关不进入公开运行时配置，生产环境不得启用。

浏览器优先调用 `PublicKeyCredential.parseCreationOptionsFromJSON()`、`parseRequestOptionsFromJSON()` 与 `toJSON()`；缺少这些接口时使用受测的 Base64URL 与 ArrayBuffer 转换。标准响应中未请求的扩展输出会拒绝，而非静默丢弃。注册和断言仍由 Go 服务端验证，浏览器结果不构成认证成功。认证器材料、Assertion 与注册私钥不写入 LocalStorage；LocalStorage 只保存取消操作标识。

Passkey 登录经既有 `AuthClient` 的 Web Locks、操作标识、状态通知和待核对标记更新应用级身份。管理写入在同一把 Web Lock 内执行，并使用独立的 Passkey 管理操作标识；响应丢失后，下一次管理写入先调用取消屏障。浏览器取消只终止认证窗口，不提交验证；提交阶段不再允许取消按钮，已发出的请求通过持久化屏障核对。多标签页通过既有身份通知重新查询 Session。

隔离浏览器入口 `backend/tools/browser-passkey.mjs` 使用 `http://localhost:4112`、独立 PostgreSQL/Mailpit、Go API `127.0.0.1:18080` 和 Playwright 虚拟认证器，只回收本次创建的进程与容器。1A 链路使用 `http://127.0.0.1:4102` 和 Go API `127.0.0.1:18081`，两个 Passkey 开关均关闭。虚拟认证器不能替代 Windows Hello、Android、硬件密钥或正式 HTTPS 验收。

## 内部验证码与投递

验证码为 6 位数字，有效期 10 分钟，每个流程最多允许 5 次错误尝试。相同邮箱重发至少间隔 60 秒，邮箱和来源地址分别限制为每个 15 分钟固定窗口最多 3 次和 30 次。固定窗口交界可能连续使用相邻两个窗口的额度，来源地址限制不是校园网络的唯一限制。计数和重发间隔在 PostgreSQL 中原子更新，限流主体仅保存独立密钥生成的摘要。`CleanExpiredRateLimits` 只删除过期记录，目前没有自动清理调度。

真实和不可验证流程均先通过相同限流并创建不可预测的流程标识。验证码摘要使用绑定流程标识和密钥版本的 HMAC；重新申请会使同邮箱旧流程失效。不可验证流程不发送邮件，也不能成功验证。来源地址的代理信任依据见 [配置](#配置)。

邮件由进程内有界容量限制并在事务提交后异步发送。容量检查发生在查询账户与邀请之前，真实和不可验证流程在创建成功后均占用容量 15 秒，服务关闭时提前取消。该规则降低通过后续容量状态区分流程的风险，也限制突发吞吐量。SMTP 接受邮件后才将流程标记为可验证；发送失败、进程重启或邮件接受后确认写入失败时，该邮件可能丢失或不能使用，依赖用户在限流允许后重新申请。该进程内机制没有持久投递保证，邮件正文和验证码不进入日志。

## 独立检查

在 `backend/` 运行：

```sh
bun tools/check.mjs
bun install --frozen-lockfile
bun run api:check
bun run test:integration
```

Go 检查依次执行 `gofmt`、`go vet ./...`、`go test ./...`、`go build ./...` 和固定版本的 `staticcheck`。安装受支持的 C 工具链后使用 `bun tools/check.mjs -race` 增加竞争检测。集成测试文件使用 `integration` 构建标签，默认构建与 `go test ./...` 会排除；编辑器分析需在 gopls 设置中传入 `-tags=integration`。集成测试入口创建独立 Compose 项目和测试数据库，检查固定回环端口 `15432`、`12526`、`18026`，不连接开发数据库或外部邮箱。测试结束只删除该次创建的资源。Windows 和 Linux 均需要 Docker Compose、Go、Bun 及可用于 Go 竞争检测的 C 编译器。

`bun run api:generate` 从 OpenAPI 生成 TypeScript，`api:check` 校验定义、引用、生成结果与类型。Go 测试按 OpenAPI 校验健康检查与认证处理器响应；PostgreSQL 集成测试另验证事务、会话与数据库状态。

## 接口安全约定

OpenAPI 是两端接口字段与公开错误的唯一来源。认证端点须按定义统一响应：邮箱是否可用都返回相同的 `202`，无身份时返回 `identity: null`，验证码失败和限流按定义返回错误，注销成功返回无正文的 `204`。网络错误不得当作游客或注销成功。中断的身份写入必须经持久化取消屏障确认后才能开始下一次写入；如果屏障失败，保持待核对状态。

浏览器写请求必须提供与 `PUBLIC_ORIGIN` 一致的 `Origin`，只接受 JSON，不开放跨域凭据 CORS。生产会话使用 `__Host-xca_session` Cookie，要求 `Secure`、`HttpOnly`、`Path=/`、`SameSite=Lax` 且没有 `Domain`；本地 HTTP 使用独立的 `xca_session_dev`。认证响应和错误均禁止缓存。注销只在服务端撤销成功后清除 Cookie。
