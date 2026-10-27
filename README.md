<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/XAUFE-CA/.github/main/profile/assets/xca-banner-dark.webp">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/XAUFE-CA/.github/main/profile/assets/xca-banner-light.webp">
    <img src="https://raw.githubusercontent.com/XAUFE-CA/.github/main/profile/assets/xca-banner-light.webp" alt="XCA 计算机学社横幅：真诚、包容、和谐、热爱；技术交流、知识分享与项目实践。" width="100%">
  </picture>
  XCA-Portal
</h1>

西安财经大学计算机学社（XCA）官方门户。

<p align="center">
  <a href="https://nuxt.com"><img alt="Nuxt" src="https://img.shields.io/badge/Nuxt-framework-3dd6a6?style=flat&amp;labelColor=132134&amp;logo=nuxt&amp;logoColor=f4f8fc"></a>
  <a href="https://vuejs.org"><img alt="Vue" src="https://img.shields.io/badge/Vue-interface-3dd6a6?style=flat&amp;labelColor=132134&amp;logo=vue.js&amp;logoColor=f4f8fc"></a>
  <a href="https://www.typescriptlang.org"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-language-8c9bff?style=flat&amp;labelColor=132134&amp;logo=typescript&amp;logoColor=f4f8fc"></a>
  <a href="https://bun.sh"><img alt="Bun" src="https://img.shields.io/badge/Bun-runtime-38bdf8?style=flat&amp;labelColor=132134&amp;logo=bun&amp;logoColor=f4f8fc"></a>
  <a href="https://biomejs.dev"><img alt="Biome" src="https://img.shields.io/badge/Biome-tooling-60a5fa?style=flat&amp;labelColor=132134&amp;logo=biome&amp;logoColor=f4f8fc"></a>
</p>

</div>

## 关于

XCA-Portal 是西安财经大学计算机学社的门户项目，为了解学社、获取信息与参与交流提供入口。

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 应用框架 | [Nuxt](https://nuxt.com)、[Vue](https://vuejs.org) |
| 开发语言 | [TypeScript](https://www.typescriptlang.org) |
| 界面组件 | Neoverse-UI |
| 内容管理 | [Nuxt Content](https://content.nuxt.com) |
| 开发工具 | [Bun](https://bun.sh)、[Biome](https://biomejs.dev)、Prettier |

## 开发

安装 [Bun](https://bun.sh)，并按 [工程说明](docs/architecture/engineering-quality.md#本地开发与共享依赖) 完成环境准备后运行：

```sh
bun install
bun run dev
```

## 检查

| 命令 | 用途 |
| --- | --- |
| `bun run check` | 检查与生产构建 |
| `bun run check:fast` | 检查，不含构建 |
| `bun run test` | 单元测试 |
| `bun run test:e2e` | 构建与浏览器回归 |

格式与检查约定见 [工程质量契约](docs/architecture/engineering-quality.md)。

## 构建与预览

| 命令 | 用途 |
| --- | --- |
| `bun run build` | 生产构建 |
| `bun run generate` | 静态生成 |
| `bun run preview` | 预览构建产物 |

## 参与贡献

| 事项 | 入口 |
| --- | --- |
| 参与贡献 | [贡献指南](https://github.com/XAUFE-CA/.github/blob/main/CONTRIBUTING.md) |
| 开发与协作 | [组织协作规范](https://github.com/XAUFE-CA/.github/blob/main/COLLABORATION.md) |
| 社区交流 | [行为准则](https://github.com/XAUFE-CA/.github/blob/main/CODE_OF_CONDUCT.md) |
| 安全漏洞报告 | [安全说明](https://github.com/XAUFE-CA/.github/blob/main/SECURITY.md) |

## 许可

许可与复用说明见 [组织默认许可](https://github.com/XAUFE-CA/.github#许可与复用)。
