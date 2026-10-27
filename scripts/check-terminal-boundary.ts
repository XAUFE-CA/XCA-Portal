import { resolve } from "node:path";

const failures: string[] = [];
const checks = [
  { pattern: /<(button|select|textarea)\b/g, message: "交互控件应复用 Neoverse-UI" },
  { pattern: /X Computer Association|X COMPUTER ASSOCIATION/g, message: "品牌应使用 XAUFE" },
];
for await (const path of new Bun.Glob("app/features/terminal/**/*.{ts,vue}").scan(".")) {
  if (path.endsWith(".test.ts")) continue;
  const source = await Bun.file(path).text();
  if (/<input\b/.test(source)) {
    failures.push(`${path}: 命令行使用 UiTerminalPrompt，普通表单使用 UiInput`);
  }
  for (const check of checks)
    if (check.pattern.test(source)) failures.push(`${path}: ${check.message}`);
  checks.forEach((check) => {
    check.pattern.lastIndex = 0;
  });
}
const cssPath = "app/assets/css/terminal.css";
const css = await Bun.file(cssPath).text();
for (const [pattern, message] of [
  [
    /#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})\b|\b(?:rgb|hsl|oklch)a?\(/gi,
    "颜色应来自 Neoverse-UI tokens",
  ],
  [/\b\d+(?:\.\d+)?(?:ms|s)\b/g, "动画时长应来自 Neoverse-UI tokens"],
  [/\.xca-terminal-tool(?:\s|:|\{)/g, "不要重新实现按钮材质"],
  [/\.xca-terminal-prompt__input\b/g, "不要重新实现共享终端编辑器样式"],
  [/\.ui-terminal-[\w-]+/g, "不要通过共享组件内部选择器覆盖终端样式"],
  [/\.xca-prompt-identity[\w-]*/g, "历史命令使用共享文本行，不另建提示符样式"],
  [/--neoverse-font-family-[\w-]+\s*:/g, "终端字体角色由 Neoverse-UI 维护"],
] as const) {
  // Zero is a valid absence of a stagger, rather than a motion duration.
  // 零表示确实没有错峰延迟，而非运动时长。
  const source = css.replace(/\b0ms\b/g, "0");
  if (pattern.test(source)) failures.push(`${cssPath}: ${message}`);
}
// Geometry is consumer-owned; shared chrome, text and semantic colors are not.
// 几何属性归消费方所有；共享外框、文本与语义色则不归其所有。
for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const [, selector, declarations] = block;
  if (selector === undefined || declarations === undefined)
    throw new Error("CSS block pattern must capture a selector and declarations");
  if (
    /\.xca-terminal-(?:window|screen|line|command|statusbar|font-probe)(?![\w-])/.test(selector) &&
    /(?:^|[;\n])\s*(?:font(?:-[\w-]+)?|line-height|letter-spacing|color|border(?:-[\w-]+)?|background(?:-color)?)\s*:/.test(
      declarations,
    )
  )
    failures.push(`${cssPath}: ${selector.trim()} 不应重复定义共享终端材质或文字样式`);
}
const tokens = new Set<string>();
for await (const path of new Bun.Glob(
  "node_modules/@neoverse-ui/{tokens,tailwind}/dist/**/*.css",
).scan(".")) {
  for (const match of (await Bun.file(path).text()).matchAll(/(--neoverse-[\w-]+)\s*:/g)) {
    const [, token] = match;
    if (token === undefined) throw new Error("Token definition pattern must capture a name");
    tokens.add(token);
  }
}
if (!tokens.size) failures.push("未找到已安装的 Neoverse-UI token 定义");
for (const match of css.matchAll(/var\((--neoverse-[\w-]+)/g)) {
  const [, token] = match;
  if (token === undefined) throw new Error("Token reference pattern must capture a name");
  if (!tokens.has(token)) failures.push(`${cssPath}: 未定义的 token ${token}`);
}
for (const match of css.matchAll(/font-family\s*:\s*([^;]+)/g)) {
  const [, family] = match;
  if (family === undefined) throw new Error("Font family pattern must capture a value");
  if (!family.trim().startsWith("var("))
    failures.push(`${cssPath}: 字体应来自已注册外观或 Neoverse-UI tokens`);
}
for await (const path of new Bun.Glob("app/assets/css/*.css").scan(".")) {
  const source = await Bun.file(path).text();
  if (
    /--neoverse-(?:navigation-item|control-segmented|button|action)-(?:height|font-size|padding)[\w-]*\s*:/.test(
      source,
    )
  )
    failures.push(`${path}: Shared control sizes must use the Neoverse-UI component contract`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Terminal UI boundary passed (${resolve(cssPath)})`);
