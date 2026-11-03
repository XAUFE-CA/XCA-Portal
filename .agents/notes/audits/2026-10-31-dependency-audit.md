# 依赖安全待办

Status: open

更新日期：2026-10-31。

门户工作区执行 `bun audit --registry https://registry.npmjs.org`，返回 6 项漏洞：3 high、2 moderate、1 low，退出码为 1。

| 依赖（门户锁定版本） | 级别 | 公告 |
| --- | --- | --- |
| Happy DOM 20.14.6 | high × 2 | [宿主代码执行](https://github.com/advisories/GHSA-834v-8h66-3h79)、[服务端请求伪造](https://github.com/advisories/GHSA-c8p4-j97h-3vg8) |
| Zod 3.25.76 | high | [集合校验内存耗尽](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |
| glob 13.0.6、10.5.0 | moderate | [取消后继续遍历文件系统](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| minimatch 10.2.6、5.1.9、9.0.9 | moderate | [匹配模式放大导致拒绝服务](https://github.com/advisories/GHSA-g3hv-75wg-m249) |
| deepmerge 4.3.1 | low | [返回对象的原型污染](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) |

待处理：评估实际暴露路径与上游兼容修复方案，升级后重新审计。不使用跨主版本覆盖或忽略项隐藏告警，处理规则见 [依赖维护](../../../docs/architecture/engineering-quality.md#工具链与依赖维护)。

本次未修改依赖，也未单独审计共享库工作区。以上结果仅代表本次门户审计，不替代后续复验。
