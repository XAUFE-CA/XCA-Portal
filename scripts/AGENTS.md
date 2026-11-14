# scripts 结构

修改本目录前读本文件。命令、端口与依赖以根清单和配置为准，门禁分级见 [工程质量规则](../docs/architecture/engineering-quality.md)，测试层级见 [测试注册表](../docs/testing/README.md)。

```text
scripts/
  gates/     门禁实现、聚合执行、源码分析与阈值配置
  tests/     测试注册表、执行计划与对应单元测试
  deps/      共享库依赖来源识别与同步
  build/     构建信息、终端文本戳记与字体子集
```

## gates/

| 文件 | 职责 |
| --- | --- |
| check-architecture.ts | 检查 app 静态导入、循环与终端 Core 宿主能力 |
| check-budgets.ts | 行数、函数行数与文档内容量阈值 |
| check-docs.ts | 内部链接与禁用表述 |
| check-references.ts | 命令入口路径与清单脚本名的一致性 |
| check-terminal-boundary.ts | 终端共享控件、公开样式变量、固定颜色与时长 |
| check-test-registry.ts | 测试注册表与仓库双向核对 |
| run-gates.ts | 按顺序聚合门禁，构建最后执行 |
| source-analysis.ts | TypeScript/Vue 解析、导入图、循环与计量 |
| quality-budgets.json | 阈值与已审查例外；上限变化须写明原因 |
| quality.test.ts | 阈值、文档、源码分析与门禁聚合的单元测试 |
| quality-cli.test.ts | 检查脚本 CLI 在独立临时目录中的测试 |
| run-gates.test.ts | 门禁摘要、失败继续与构建跳过的隔离测试 |

## tests/

| 文件 | 职责 |
| --- | --- |
| test-registry.ts | 解析注册表、展开范围、核对覆盖与元数据 |
| test-plan.ts | 生成并执行层级计划；`list` 与 `run` 入口 |
| test-registry.test.ts | 解析、元数据与覆盖核对测试 |

## deps/

| 文件 | 职责 |
| --- | --- |
| sync-neoverse-ui.ts | `ui:sync` 入口，委托共享库同步器并核对安装目录 |
| ui-dependencies.ts | 本地、发布与混合依赖来源判定 |
| ui-dependencies.test.ts | 来源判定单元测试 |
| ui-sync.test.ts | 同步入口在独立临时目录中的行为 |

## build/

| 文件 | 职责 |
| --- | --- |
| build-info.ts | 读取 Git 提交并生成构建信息 |
| build-info.test.ts | 记录解析与缺失时间戳测试 |
| stamp-terminal-texts.ts | 重新生成终端正文基线 |
| fonts/build-font-subsets.py | 字体子集生成 |
| fonts/glyph-coverage.json | 字形覆盖清单 |

新增文件先归入现有目录。新增目录须同步本文件与根目录树，并接入 `gates/run-gates.ts` 或测试注册表，否则门禁不覆盖新入口。
