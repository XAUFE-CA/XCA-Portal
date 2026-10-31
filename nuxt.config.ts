import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
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
    "~/assets/css/terminal.css",
  ],
  devtools: { enabled: false },
  typescript: { strict: true },
  app: {
    head: {
      meta: [{ name: "color-scheme", content: "light dark" }],
      script: [{ src: "/intro-gate.js", tagPosition: "head" }],
      // Register cascade order before SSR styles, whose dev order can change across requests.
      // 在 SSR 样式之前声明层叠顺序，避免开发请求间的样式顺序变化影响页面。
      style: [
        {
          innerHTML: "@layer properties, theme, base, components, utilities, neoverse;",
          tagPriority: "critical",
        },
      ],
      link: [{ rel: "icon", type: "image/svg+xml", href: "/brand/ca-mark.svg" }],
    },
  },
});
