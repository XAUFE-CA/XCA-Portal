# 测试注册表与执行计划

Status: adopted

本文件是测试层级、执行器与执行参数的唯一依据。`tests/`、`app/` 与 `scripts/` 中的测试文件是实际内容，[注册表检查](../../scripts/gates/check-test-registry.ts) 双向核对表格与仓库：表格声明的范围必须存在，仓库中的测试文件也必须登记。测试命令由 [执行计划](../../scripts/tests/test-plan.ts) 读取本表后生成，CI 调用同一入口。

## 层级

| 层级 | 范围 | 执行器 |
| --- | --- | --- |
| unit | 单个模块或少量纯函数，不启动浏览器，不读取仓库外状态 | `bun test` |
| module | 跨模块、仓库数据、临时文件目录或模块导出的接口 | `bun test` |
| system | 生产构建上的浏览器行为 | `playwright test` |

图片基线与完整入场场景属于 system 层级，分别用 `snapshot` 与 `scene` 元数据标记。

Go 后端的单元测试、健康检查与认证响应对 OpenAPI 的校验由 `backend/` 内的 `go test ./...` 执行，不由门户测试注册表发现或计入浏览器分片。`bun run test:integration` 在独立 PostgreSQL 和 Mailpit 中运行带 `integration` 标签的迁移、邀请、验证码、限流、邮件、会话与认证接口测试，并开启 Go 竞争检测。该入口需要 Docker Compose、Go 和 C 工具链，使用固定回环端口 `15432`、`12526` 和 `18026`，仅回收本次创建的资源。真实浏览器、Nuxt 代理和 Go 服务的联合部署验证应单独运行，不由数据库集成测试代替。

Passkey 服务端测试使用受控认证器数据，由正式 WebAuthn 库解析和验证。登录测试使用临时私钥生成真实断言签名。PostgreSQL 用例覆盖挑战与凭据事务、近期 OTP、签名计数、匿名限流和取消竞争；HTTP 用例按 OpenAPI 校验启用和关闭状态。`--live` 保持 1A 邮件认证链路，浏览器 Passkey 与硬件验收留在独立阶段，不加入普通浏览器分片。

Passkey 浏览器用例归入 `tests/e2e/passkey/*.spec.ts`，使用 `playwright.passkey.config.ts` 与 `--passkey` 选择，入口 `bun run test:browser:passkey` 在 `backend/` 中执行。该入口准备 `localhost` 来源、隔离 PostgreSQL/Mailpit、Go API 与 Nuxt 生产预览，并通过 Playwright 虚拟认证器执行真实 `navigator.credentials.create()`/`get()`。测试失败时保留 `test-results/passkey` 的 Trace 与录像；每次用例重置隔离库中的认证状态，不清理开发数据库。虚拟认证器结果不代表真实平台认证器验收。

两个认证入口默认自行构建。加 `--artifacts` 时直接使用同平台解包后的 `.output/` 与 `backend/bin/`，运行产物中的迁移、邀请和 API 命令，不重新构建。CI 在独立运行器执行每个套件，只有失败时上传 Playwright 证据，保留 3 天。证据可能包含本次运行的短时测试值，不使用生产数据、凭据或邮箱。

## 注册表

Scope 为仓库相对路径，可含 `*` 通配符。Args 记录该范围固定的执行器参数，当前没有按范围追加的参数。Metadata 为逗号分隔的属性，含义见下一节。

| Scope | Level | Runner | Args | Metadata |
| --- | --- | --- | --- | --- |
| app/components/home/*.test.ts | unit | bun-test | — | — |
| app/data/terminal/*.test.ts | module | bun-test | — | — |
| app/features/auth/passkey/*.test.ts | module | bun-test | — | — |
| app/features/auth/session/*.test.ts | module | bun-test | — | — |
| app/features/context-menu/core/*.test.ts | unit | bun-test | — | — |
| app/features/context-menu/presentation/actions/*.test.ts | module | bun-test | — | — |
| app/features/context-menu/presentation/interaction/*.test.ts | module | bun-test | — | — |
| app/features/intro/core/*.test.ts | unit | bun-test | — | — |
| app/features/intro/presentation/*.test.ts | unit | bun-test | — | — |
| app/features/intro/rendering/environment/*.test.ts | unit | bun-test | — | — |
| app/features/intro/rendering/scene/*.test.ts | unit | bun-test | — | — |
| app/features/tagline-flame/core/*.test.ts | unit | bun-test | — | — |
| app/features/tagline-flame/rendering/*.test.ts | unit | bun-test | — | — |
| app/features/terminal/branding/*.test.ts | unit | bun-test | — | — |
| app/features/terminal/commands/*.test.ts | module | bun-test | — | — |
| app/features/terminal/commands/session/*.test.ts | module | bun-test | — | — |
| app/features/terminal/core/*.test.ts | module | bun-test | — | — |
| app/features/terminal/presentation/*.test.ts | unit | bun-test | — | — |
| app/i18n/*.test.ts | module | bun-test | — | — |
| app/utils/copyright.test.ts | unit | bun-test | — | — |
| app/utils/glass-motion.test.ts | module | bun-test | — | — |
| scripts/build/build-info.test.ts | unit | bun-test | — | — |
| scripts/deps/ui-dependencies.test.ts | unit | bun-test | — | — |
| scripts/deps/ui-sync.test.ts | module | bun-test | — | isolated |
| scripts/gates/quality-cli.test.ts | module | bun-test | — | isolated |
| scripts/gates/quality.test.ts | module | bun-test | — | isolated |
| scripts/gates/run-gates.test.ts | module | bun-test | — | isolated |
| scripts/tests/test-registry.test.ts | unit | bun-test | — | — |
| tests/e2e/site/*.spec.ts | system | playwright | — | browser, scene |
| tests/e2e/home/*.spec.ts | system | playwright | — | browser, scene |
| tests/e2e/intro/*.spec.ts | system | playwright | — | browser, scene |
| tests/e2e/terminal/*.spec.ts | system | playwright | — | browser, scene |
| tests/e2e/live/*.spec.ts | system | playwright | — | browser, live |
| tests/e2e/passkey/*.spec.ts | system | playwright | --config=playwright.passkey.config.ts | browser, passkey |
| tests/e2e/visual/*.spec.ts | system | playwright | — | browser, snapshot |

## 元数据

| 名称 | 含义 | 机械核对 |
| --- | --- | --- |
| browser | 需要生产构建与无头 Chromium | Runner 必须为 `playwright` |
| isolated | 每个用例写独立临时目录，不读写共享状态 | 范围内文件包含 `mkdtempSync(` |
| scene | 包含 `@cinematic` 用例；依赖 GPU 完整场景或首页入场在时间上稳定完成，推送门禁排除，由 `--scene` 计划在有 GPU 的本地环境运行 | 范围内文件包含 `@cinematic` |
| snapshot | 与图片基线比对，基线属于渲染它的机器 | 文件包含 `toHaveScreenshot(`，且基线目录含 PNG |
| live | 真实 Go、PostgreSQL、Mailpit、Nuxt 同源代理与浏览器联合验证，不进入普通分片 | 用例名称包含 `@live-auth` |
| passkey | 隔离 `localhost` 来源、虚拟认证器、真实 Go/PostgreSQL/Nuxt 的 Passkey 链路；使用独立配置，不进入普通分片和 1A 链路 | 用例名称包含 `@live-passkey` |

属性与文件内容双向核对：声明了属性却没有对应证据会失败，出现证据却没有登记属性同样失败。

## 执行

| 命令 | 计划 |
| --- | --- |
| `bun run test` | unit 与 module，先读取注册表生成文件清单 |
| `bun run check:tests` | 只运行注册表一致性检查 |
| `bun run test:e2e` | 生产构建后运行 system，排除 `@cinematic` |
| `bun run test:scene` | 生产构建后运行 `@cinematic`，设置 `XCA_CINEMATIC=1` |
| `bun run test:visual` | 生产构建后只运行 `snapshot` 范围 |
| `bun run test:browser`（在 `backend/` 中执行） | 隔离启动真实依赖与 Go API，执行 `--live` 范围并回收自身资源 |
| `bun run test:browser:passkey`（在 `backend/` 中执行） | 使用独立 `localhost` 来源、虚拟认证器与隔离数据库执行 `--passkey` 范围，并回收自身资源 |

`bun scripts/tests/test-plan.ts list <层级>` 只打印文件与命令，`run <层级>` 执行。`--shard=N/M` 传给 Playwright，用于 CI 分片；`--ignore-snapshots` 与 `--update-snapshots` 原样传给 Playwright。`--scene` 只选择带 `scene` 元数据的范围，`--snapshot` 只选择带 `snapshot` 元数据的范围，`--no-snapshot` 排除该范围。`--live` 只选择独立的真实认证链路用例。`--passkey` 只选择 Passkey 虚拟认证器用例，与 `live`、场景、图片和分片互斥。两个范围都不进入普通浏览器分片；各自的入口负责创建和回收临时依赖。

CI 工作流不单独书写计划路径，通过 `bun run test:ci`、`bun run test:scene:ci` 与 `bun run test:visual:ci` 调用同一入口，用 `--` 追加分片与基线参数。推送门禁只执行不依赖 GPU 的用例；`@cinematic` 用例由本地 `bun run test:scene` 在具备 GPU 的环境验收，托管运行器的结果不作为依据。

## 浏览器回归

浏览器回归的观测约定、运行要求与结果记录见 [浏览器回归](browser-regression.md)。

## 维护

新增测试文件放入已登记的范围即被登记；新增目录、层级或执行器时，先在本表增加一行，否则 `check:tests` 失败。删除测试文件后同步删除没有文件的表格行，或改由合法通配符覆盖。执行器与检查器共用 [注册表模块](../../scripts/tests/test-registry.ts) 的解析与核对逻辑，不维护第二份清单。

门禁分级、规模阈值与 CI 决策见 [工程质量规则](../architecture/engineering-quality.md)。
