import { expect, test } from "bun:test";
import type { SiteLocale } from "../../../i18n";
import { registerVirtualFiles } from "../client-session";
import { TerminalSession } from "../core/session";
import type { TerminalServices } from "../core/types";
import { cellWidth } from "./helpers";
import { terminalCommands } from "./index";

function makeSession(locale: SiteLocale = "zh-CN"): TerminalSession {
  const services: TerminalServices = {
    getLocale: () => locale,
    navigate: () => {},
    getTheme: () => "system",
    setTheme: () => {},
    replayIntro: () => {},
  };
  const session = new TerminalSession(services);
  for (const command of terminalCommands) session.registry.register(command);
  registerVirtualFiles(session);
  session.resetWelcome();
  return session;
}
const texts = (session: TerminalSession) =>
  session.entries
    .filter((entry) => entry.type === "line")
    .map((entry) => entry.text)
    .join("\n");
async function run(session: TerminalSession, source: string): Promise<string> {
  await session.execute("clear");
  await session.execute(source);
  return texts(session);
}
test("ls accepts one known option and reports sizes with the type prefix", async () => {
  const session = makeSession();
  expect(await run(session, "ls")).toContain("README.md");
  expect(await run(session, "ls -a")).toContain(".profile");
  expect(await run(session, "ls")).not.toContain(".profile");
  const detailed = await run(session, "ls -l");
  expect(detailed).toMatch(/^-\s+\d+\s+README\.md$/m);
  expect(await run(session, "ls -al")).toContain(".profile");
  expect(await run(session, "ls -l /")).toMatch(/^d\s+\d+\s+home\/$/m);
  for (const source of ["ls -aaaa", "ls -lalala", "ls -l -l", "ls -l -a", "ls a b"]) {
    expect(await run(session, source)).toContain("用法：ls [option] [path]");
  }
  expect(session.complete("cat ")).toEqual(["cat README.md"]);
  expect(session.complete("cat .")).toEqual(["cat .profile"]);
});
test("usage errors name placeholders and list accepted values", async () => {
  const session = makeSession();
  expect(await run(session, "ls -x")).toBe("用法：ls [option] [path]\n可用参数：-a, -l, -la, -al");
  expect(await run(session, "xca open missing")).toBe(
    "用法：xca open <page>\n可用参数：home, about",
  );
  expect(await run(session, "xca theme missing")).toBe(
    "用法：xca theme [theme]\n可用参数：light, dark, system",
  );
  expect(await run(session, "xca background missing")).toBe(
    "用法：xca background [preset]\n可用参数：default, canvas",
  );
  expect(await run(session, "man xca open")).toContain("可用参数：home, about");
});
test("cat writes successful files before reporting a later missing path once", async () => {
  const session = makeSession();
  const output = await run(session, "cat README.md /missing");
  expect(output).toContain("只读虚拟工作区");
  expect(output.split("只读虚拟工作区")).toHaveLength(2);
  expect(session.entries.at(-1)).toMatchObject({
    text: "执行失败：/missing: 没有此虚拟文件或目录",
    tone: "error",
  });
  expect(session.status).toBe(1);
  await session.execute("clear");
  await session.execute("cat README.md");
  expect(session.status).toBe(0);
  expect(texts(session).split("只读虚拟工作区")).toHaveLength(2);
});
test("printenv queries one variable and stays separate from env", async () => {
  const session = makeSession();
  expect(session.registry.resolve("printenv")?.name).toBe("printenv");
  expect(session.registry.resolve("env")?.name).toBe("env");
  expect(await run(session, "printenv HOME")).toBe("/home/guest");
  const all = await run(session, "printenv");
  expect(all).toContain("USER=guest");
  expect(all).toContain("SHELL=xca-sh");
  expect(await run(session, "printenv PWD")).toBe("/home/guest");
  expect(await run(session, "printenv NOPE")).toContain("未定义的环境变量：NOPE");
  expect(await run(session, "env extra")).toContain("用法：env");
  expect(await run(session, "printenv A B")).toContain("用法：printenv [variable]");
});
test("help groups top-level commands while nested subcommands stay flat", async () => {
  const session = makeSession();
  const lines = (await run(session, "help")).split("\n");
  for (const title of ["会话", "文件", "系统", "站点"]) expect(lines).toContain(title);
  expect(lines.indexOf("会话")).toBeLessThan(lines.indexOf("文件"));
  expect(lines.indexOf("文件")).toBeLessThan(lines.indexOf("系统"));
  expect(lines.indexOf("系统")).toBeLessThan(lines.indexOf("站点"));
  expect(await run(session, "xca")).not.toContain("站点\n");
});
test("man reads command usage while help only lists commands", async () => {
  const session = makeSession();
  expect(session.registry.resolve("man")?.name).toBe("man");
  expect(session.registry.resolve("cls")).toBeUndefined();
  expect(session.complete("man")).toEqual(["man"]);
  expect(session.complete("cls")).toEqual([]);
  expect(session.complete("man xca in")).toEqual(["man xca intro"]);
  expect(await run(session, "man cat")).toContain("cat <file...>");
  expect(await run(session, "man xca intro")).toContain("xca intro");
  expect(await run(session, "man nope")).toBe("没有 nope 的手册条目。");
  expect(await run(session, "man")).toBe("用法：man <command...>");
  expect(await run(session, "help cat")).toBe("用法：help");
  expect(await run(session, "cls")).toContain("cls: 未找到命令");
});
test("cell width counts East Asian and fullwidth glyphs as two cells", () => {
  expect(cellWidth("会话")).toBe(4);
  expect(cellWidth("（等待接入后端）")).toBe(16);
  expect(cellWidth("↑↓ Tab")).toBe(6);
  expect(cellWidth("─")).toBe(1);
});
test("help separates groups with rules as wide as the widest help line", async () => {
  const session = makeSession();
  const render = async () => {
    const lines = (await run(session, "help")).split("\n");
    return {
      lines,
      content: lines.filter((row) => !/^─+$/.test(row)),
      rules: lines.filter((row) => /^─+$/.test(row)),
    };
  };
  const { lines, content, rules } = await render();
  expect(rules).toHaveLength(3);
  expect(rules.every((rule) => rule.length === rules[0]?.length)).toBe(true);
  const widest = Math.max(...content.map(cellWidth));
  expect(rules[0]?.length).toBe(widest);
  expect(widest).toBeLessThan(78);
  const firstRule = lines.findIndex((row) => /^─+$/.test(row));
  expect(firstRule).toBeGreaterThan(lines.indexOf("会话"));
  expect(firstRule).toBeLessThan(lines.indexOf("文件"));
  session.resize({ columns: 40, rows: 24 });
  const narrow = (await render()).rules[0];
  expect(narrow?.length).toBe(38);
  session.resize({ columns: 120, rows: 24 });
  const wide = await render();
  expect(wide.rules[0]?.length).toBe(Math.max(...wide.content.map(cellWidth)));
  expect(await run(session, "xca")).not.toMatch(/^─+$/m);
});
test("echo prints every argument because the line model has no trailing newline", async () => {
  const session = makeSession();
  expect(await run(session, "echo -n hello")).toBe("-n hello");
  expect(await run(session, "echo hello world")).toBe("hello world");
  expect(await run(session, "echo")).toBe("");
});
test("xca history lists and clears every recorded command", async () => {
  const session = makeSession();
  await session.execute("echo first");
  await session.execute("echo second");
  expect(session.history).toEqual(["echo first", "echo second"]);
  session.clear();
  await session.execute("xca history");
  expect(texts(session)).toContain("01  echo first");
  session.clear();
  await session.execute("xca history clear");
  expect(session.history).toEqual([]);
  expect(texts(session)).toBe("会话历史已清除");
  expect(await run(session, "xca history keep")).toBe("用法：xca history [clear]\n可用参数：clear");
  expect(await run(session, "history clear")).toBe("history: 未找到命令。输入 help 查看可用命令。");
  expect(session.complete("xca history ")).toEqual(["xca history clear"]);
  expect(await run(session, "man xca history")).toContain("xca history [clear]");
});
