# 依赖安全待办

Status: open

更新日期：2026-11-08。

门户工作区执行 `bun audit --registry https://registry.npmjs.org`，返回 4 项漏洞：1 high、2 moderate、1 low，退出码为 1。共享库工作区同命令返回 2 项 moderate。两者都不再出现 Happy DOM。

## 2026-10-31 首次审计

当时门户锁定 6 项漏洞：3 high、2 moderate、1 low。

| 依赖（门户锁定版本） | 级别 | 公告 |
| --- | --- | --- |
| Happy DOM 20.14.6 | high × 2 | [宿主代码执行](https://github.com/advisories/GHSA-834v-8h66-3h79)、[服务端请求伪造](https://github.com/advisories/GHSA-c8p4-j97h-3vg8) |
| Zod 3.25.76 | high | [集合校验内存耗尽](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |
| glob 13.0.6、10.5.0 | moderate | [取消后继续遍历文件系统](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| minimatch 10.2.6、5.1.9、9.0.9 | moderate | [匹配模式放大导致拒绝服务](https://github.com/advisories/GHSA-g3hv-75wg-m249) |
| deepmerge 4.3.1 | low | [返回对象的原型污染](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) |

## 2026-11-08 复验

门户锁文件在默认 registry 下重新解析（`bun install --registry https://registry.npmjs.org/`），与共享库当前工具链对齐，同时把 Happy DOM 从 20.14.6 升到 21.0.4。两条 high 公告不再命中，门户与共享库都不再列出该依赖。

其余 4 项在声明范围内都没有修复版本，`bun audit fix` 只能在范围内升级，因此不改动结果：

| 依赖 | 解析版本 | 声明范围 | 上游最新 | 结论 |
| --- | --- | --- | --- | --- |
| Zod | 3.25.76 | `^3.25.76`（`@nuxt/content`） | 4.6.7 | 修复需 4.6.6 以上，属主版本升级 |
| glob | 13.0.6、10.5.0 | `^13.0.0`（`@vercel/nft`）、`^10.0.0`（`archiver-utils`） | 14.0.4 | 修复需 14.0.2 以上，属主版本升级 |
| minimatch | 10.2.6、9.0.9、5.1.9 | `^10.2.2`（`glob`）、`^10.2.6`（`@nuxt/content`） | 11.0.5 | 修复需 11.0.1 以上，属主版本升级 |
| deepmerge | 4.3.1 | `^4.2.2`（`@rollup/plugin-node-resolve`） | 4.3.1 | 上游尚无修复版本 |

共享库剩余的两项 moderate 来自 `@vue/test-utils` → `js-beautify` → glob 与 minimatch，同样只能等上游。

### Zod 暴露评估

`zod` 只经 `@nuxt/content` 使用，用于校验 `content/` 的正文集合。门户正文全部由仓库内 Markdown 维护，运行时没有把访客输入交给 Schema 的路径；该公告描述的是构造超大受约束集合导致内存耗尽，属于构建期自我消耗，不是可被访客触发的入口。因此不引入 `overrides` 或忽略项掩盖告警，等 `@nuxt/content` 支持 Zod 4 后再升级。

待处理：上游 `nuxt`、`nitropack`、`@vercel/nft` 与 `@nuxt/content` 发布新解析后复验，处理规则见 [依赖维护](../../../docs/architecture/engineering-quality.md#工具链与依赖维护)。本记录在剩余漏洞清零前保持 open 并留在 `audits/`，不归档。
