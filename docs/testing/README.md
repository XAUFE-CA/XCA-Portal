# 测试注册表与执行计划

Status: adopted

本文件是测试层级、执行器与执行参数的唯一依据。`tests/`、`app/` 与 `scripts/` 中的测试文件是实际内容，[注册表检查](../../scripts/gates/check-test-registry.ts) 双向核对表格与仓库：表格声明的范围必须存在，仓库中的测试文件也必须登记。测试命令由 [执行计划](../../scripts/tests/test-plan.ts) 读取本表后生成，CI 调用同一入口。

## 层级

| 层级 | 范围 | 执行器 |
| --- | --- | --- |
| unit | 单个模块或少量纯函数，不启动浏览器，不读取仓库外状态 | `bun test` |
| module | 跨模块、仓库数据、文件系统夹具或模块导出的接口 | `bun test` |
| system | 生产构建上的浏览器行为 | `playwright test` |

图片基线与完整入场场景属于 system 层级，分别用 `snapshot` 与 `scene` 元数据标记。

## 注册表

Scope 为仓库相对路径，可含 `*` 通配符。Args 记录该范围固定的执行器参数，当前没有按范围追加的参数。Metadata 为逗号分隔的属性，含义见下一节。

| Scope | Level | Runner | Args | Metadata |
| --- | --- | --- | --- | --- |
| app/components/home/*.test.ts | unit | bun-test | — | — |
| app/data/terminal/*.test.ts | module | bun-test | — | — |
| app/features/context-menu/core/*.test.ts | unit | bun-test | — | — |
| app/features/context-menu/presentation/*.test.ts | module | bun-test | — | — |
| app/features/intro/core/*.test.ts | unit | bun-test | — | — |
| app/features/intro/presentation/*.test.ts | unit | bun-test | — | — |
| app/features/intro/rendering/*.test.ts | unit | bun-test | — | — |
| app/features/tagline-flame/core/*.test.ts | unit | bun-test | — | — |
| app/features/tagline-flame/rendering/*.test.ts | unit | bun-test | — | — |
| app/features/terminal/branding/*.test.ts | unit | bun-test | — | — |
| app/features/terminal/commands/*.test.ts | module | bun-test | — | — |
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
| tests/e2e/site/*.spec.ts | system | playwright | — | browser |
| tests/e2e/home/*.spec.ts | system | playwright | — | browser, scene |
| tests/e2e/intro/*.spec.ts | system | playwright | — | browser, scene |
| tests/e2e/terminal/*.spec.ts | system | playwright | — | browser, scene |
| tests/e2e/visual/*.spec.ts | system | playwright | — | browser, snapshot |

## 元数据

| 名称 | 含义 | 机械核对 |
| --- | --- | --- |
| browser | 需要生产构建与无头 Chromium | Runner 必须为 `playwright` |
| isolated | 每个用例写独立临时目录，不读写共享状态 | 范围内文件包含 `mkdtempSync(` |
| scene | 包含 `@cinematic` 用例，只由 cinematic 工作流运行 | 范围内文件包含 `@cinematic` |
| snapshot | 与图片基线比对，基线属于渲染它的机器 | 文件包含 `toHaveScreenshot(`，且基线目录含 PNG |

属性与文件内容双向核对：声明了属性却没有对应证据会失败，出现证据却没有登记属性同样失败。

## 执行

| 命令 | 计划 |
| --- | --- |
| `bun run test` | unit 与 module，先读取注册表生成文件清单 |
| `bun run check:tests` | 只运行注册表一致性检查 |
| `bun run test:e2e` | 生产构建后运行 system，排除 `@cinematic` |
| `bun run test:scene` | 生产构建后运行 `@cinematic`，设置 `XCA_CINEMATIC=1` |
| `bun run test:visual` | 生产构建后只运行 `snapshot` 范围 |

`bun scripts/tests/test-plan.ts list <层级>` 只打印文件与命令，`run <层级>` 执行。`--shard=N/M` 传给 Playwright，用于 CI 分片；`--ignore-snapshots` 与 `--update-snapshots` 原样传给 Playwright。`--scene` 只选择带 `scene` 元数据的范围，`--snapshot` 只选择带 `snapshot` 元数据的范围，`--no-snapshot` 排除该范围。

## 浏览器回归

浏览器回归的观测约定、运行要求与结果记录见 [浏览器回归](browser-regression.md)。

## 维护

新增测试文件放入已登记的范围即被登记；新增目录、层级或执行器时，先在本表增加一行，否则 `check:tests` 失败。删除测试文件后同步删除没有文件的表格行，或改由合法通配符覆盖。执行器与检查器共用 [注册表模块](../../scripts/tests/test-registry.ts) 的解析与核对逻辑，不维护第二份清单。

门禁分级、规模阈值与 CI 决策见 [工程质量规则](../architecture/engineering-quality.md)。
