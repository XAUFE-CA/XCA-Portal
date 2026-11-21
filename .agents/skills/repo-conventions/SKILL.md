---
name: repo-conventions
description: 本仓库的规范入口。通用方法与可复制模板维护在 SkillLoom 的 repo-conventions 技能，本文件只列上游位置与本仓库的路径索引。当需要按本仓库规范修改文档、检查脚本、测试或目录入口时使用。
---

# 仓库规范入口

通用方法、六条原则、五份模板与实施阶段维护在 SkillLoom 的 `repo-conventions` 技能，本仓库不保存第二份。修改规范方法时改上游；本文件只维护本仓库的路径索引，随目录结构调整。

## 上游位置

- 远端仓库：`https://github.com/SSJ-ZYJ/SkillLoom`，技能目录 `skills/repo-conventions/`
- 本地检出：`<SkillLoom 检出目录>/skills/repo-conventions/`。未检出时以远端仓库为准，按需克隆到仓库外目录。

## 本仓库入口

| 内容 | 位置 |
| --- | --- |
| 全局约束、仓库布局与验证矩阵 | `AGENTS.md` |
| 脚本目录结构与文件职责 | `scripts/AGENTS.md` |
| 文档写作规则 | `docs/AGENTS.md` |
| 术语、缩写与用词对照 | `docs/terminology/terms.md` |
| 翻译与双语规则 | `docs/terminology/translation.md` |
| 质量规则、门禁分级与规模阈值 | `docs/architecture/engineering-quality.md` |
| 测试层级与注册表 | `docs/testing/README.md` |
| 门禁实现与阈值配置 | `scripts/gates/` |
| 过程材料与 Agent 资源 | `.agents/AGENTS.md` |

## 何时读上游

- 新增、拆分或审查 `AGENTS.md`。
- 新增检查脚本、阈值或阈值例外。
- 新增测试目录、测试层级或执行器。
- 判断一段内容该进 `docs/`、`content/` 还是 `.agents/notes/`。
- 在其他仓库建立同一套规范。
