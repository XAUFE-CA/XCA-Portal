import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readBuildInfo } from "./scripts/build-info";
import { uiDependencyState } from "./scripts/ui-dependencies";

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { dependencies?: Record<string, string>; overrides?: Record<string, string> };
// Local file: dependencies are early-development only; published versions resolve normally.
// 本地 file: 依赖仅用于早期开发；发布版本按正常包解析。
const uiState = uiDependencyState(manifest);
if (uiState === "mixed") throw new Error("Neoverse-UI 依赖不能混用 file: 与发布版本。");
const localUi = uiState === "local";
const uiAliases = localUi
  ? [
      ...["vue", "tailwind"].map((name) => ({
        find: `@neoverse-ui/${name}/index.css`,
        replacement: fileURLToPath(
          new URL(`../Neoverse-UI/packages/${name}/dist/index.css`, import.meta.url),
        ),
      })),
      ...["vue", "motion", "overlay-runtime", "glass-runtime"].map((name) => ({
        find: new RegExp(`^@neoverse-ui/${name}$`),
        replacement: fileURLToPath(
          new URL(`../Neoverse-UI/packages/${name}/dist/index.js`, import.meta.url),
        ),
      })),
    ]
  : [];

const brandMark = readFileSync(new URL("./public/brand/ca-mark.svg", import.meta.url), "utf8");
const faviconSvg = brandMark.replace(/viewBox="[^"]*"/, 'viewBox="176 178 928 928"');
// A source rewrite would silently ship an unclipped favicon, so fail loudly instead.
// 源文件改写会静默输出未裁剪的图标，因此此处直接失败。
if (faviconSvg === brandMark) throw new Error("Favicon viewBox override did not apply");

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  // The footer links the exact commit that produced this build, not the runtime HEAD; an
  // absent commit is omitted so the footer hides that row instead of inventing one.
  // 页脚链接的是产出本次构建的提交，而不是运行时的 HEAD；无提交信息时省略该值，页脚隐藏该行。
  runtimeConfig: { public: { buildInfo: readBuildInfo() ?? undefined } },
  modules: ["@nuxt/content"],
  devServer: { port: 4100 },
  // Neoverse-UI CSS is already prefixed; Nuxt Autoprefixer misparses its @supports clause.
  // Neoverse-UI 样式已带前缀；Nuxt 的 Autoprefixer 会误解析其 @supports 子句。
  postcss: { plugins: { autoprefixer: false } },
  // Resolve local runtime builds outside node_modules so Vite caches keep dev pages current.
  // 在 node_modules 外解析本地运行时构建，使已打开的开发页面保持最新。
  vite: {
    resolve: {
      ...(localUi ? { alias: uiAliases } : {}),
      dedupe: ["vue"],
    },
    ...(localUi
      ? {
          optimizeDeps: {
            exclude: [
              "@neoverse-ui/vue",
              "@neoverse-ui/motion",
              "@neoverse-ui/overlay-runtime",
              "@neoverse-ui/glass-runtime",
            ],
          },
        }
      : {}),
  },
  css: [
    "@neoverse-ui/vue/index.css",
    "@neoverse-ui/tailwind/prose.css",
    "~/assets/css/fonts.css",
    "~/assets/css/main.css",
    "~/assets/css/context-menu.css",
    "~/assets/css/terminal.css",
    "~/assets/css/terminal-intro.css",
    "~/assets/css/terminal-adaptive.css",
  ],
  devtools: { enabled: false },
  typescript: { strict: true },
  // Route changes run as a View Transition crossfade instead of a hard cut between pages.
  // 路由切换以 View Transition 交叉淡化完成，而不是页面之间硬切。
  experimental: { viewTransition: true },
  app: {
    head: {
      meta: [{ name: "color-scheme", content: "light dark" }],
      script: [{ src: "/intro-gate.js", tagPosition: "head" }],
      // Register cascade order before SSR styles, whose dev order can change across requests.
      // 在 SSR 样式之前声明层叠顺序，避免开发请求间的样式顺序变化影响页面。
      style: [
        {
          key: "xca-cascade-order",
          innerHTML: "@layer properties, theme, base, components, utilities, neoverse;",
          tagPriority: "critical",
        },
      ],
      link: [
        {
          rel: "icon",
          type: "image/svg+xml",
          sizes: "any",
          href: `data:image/svg+xml,${encodeURIComponent(faviconSvg)}`,
        },
      ],
    },
  },
});
