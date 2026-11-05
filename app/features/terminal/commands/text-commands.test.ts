import { expect, test } from "bun:test";
import type { SiteLocale } from "../../../i18n";
import { registerVirtualFiles } from "../client-session";
import { TerminalSession } from "../core/session";
import type { TerminalServices } from "../core/types";
import { terminalCommands } from "./index";
import { wait } from "./system";

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
function register(session: TerminalSession, path: string, body: string): void {
  session.workspace.register({ path, kind: "file", read: () => body });
}
const numbered = (count: number): string =>
  Array.from({ length: count }, (_, index) => `line${index + 1}`).join("\n");

test("basename and dirname handle trailing slashes and suffixes as strings", async () => {
  const session = makeSession();
  expect(await run(session, "basename /usr/lib/")).toBe("lib");
  expect(await run(session, "basename /home/guest/README.md")).toBe("README.md");
  expect(await run(session, "basename foo.txt .txt")).toBe("foo");
  expect(await run(session, "basename .txt .txt")).toBe(".txt");
  expect(await run(session, "basename /")).toBe("/");
  expect(await run(session, "basename a b c")).toContain("用法：basename <path> [suffix]");
  expect(await run(session, "dirname /usr/lib/")).toBe("/usr");
  expect(await run(session, "dirname /")).toBe("/");
  expect(await run(session, "dirname a")).toBe(".");
  expect(await run(session, "dirname a//b")).toBe("a");
  expect(await run(session, "dirname")).toContain("用法：dirname <path>");
});
test("head and tail honour the line count, defaults and the shared limit", async () => {
  const session = makeSession();
  register(session, "/lines.txt", `${numbered(25)}\n`);
  expect(await run(session, "head /lines.txt")).toBe(
    Array.from({ length: 10 }, (_, index) => `line${index + 1}`).join("\n"),
  );
  expect(await run(session, "head -n 3 /lines.txt")).toBe("line1\nline2\nline3");
  expect(await run(session, "tail /lines.txt")).toBe(
    Array.from({ length: 10 }, (_, index) => `line${index + 16}`).join("\n"),
  );
  expect(await run(session, "tail -n 2 /lines.txt")).toBe("line24\nline25");
  expect(await run(session, "head -n 500 /lines.txt")).toContain("行数超出上限：最多 200 行");
  expect(await run(session, "tail -n -1 /lines.txt")).toContain("用法：tail [-n <count>] <file>");
  expect(await run(session, "head /missing")).toContain("执行失败：/missing");
});
test("wc counts lines, words and bytes for one file and for several", async () => {
  const session = makeSession();
  register(session, "/words.txt", "alpha beta\ngamma\n");
  expect(await run(session, "wc /words.txt")).toBe("2 3 17 /words.txt");
  expect(await run(session, "wc -l /words.txt")).toBe("2 /words.txt");
  expect(await run(session, "wc -w /words.txt")).toBe("3 /words.txt");
  expect(await run(session, "wc -c /words.txt")).toBe("17 /words.txt");
  const multiple = await run(session, "wc -l /words.txt README.md");
  expect(multiple).toContain("2 /words.txt");
  expect(multiple).toMatch(/^\d+ total$/m);
  expect(await run(session, "wc -l -w /words.txt")).toContain("用法：wc [option] <file...>");
  expect(await run(session, "wc -x /words.txt")).toContain("用法：wc [option] <file...>");
  expect(await run(session, "wc -x /words.txt")).toContain("可用参数：-l, -w, -c");
  expect(await run(session, "wc /missing")).toContain("执行失败：/missing");
});
test("grep compares literal text instead of compiling the pattern", async () => {
  const session = makeSession();
  register(
    session,
    "/literal.txt",
    "alpha.*beta\nalphaZZbeta\n[x] marker\nplain line\nALPHA.*BETA",
  );
  expect(await run(session, "grep alpha.*beta /literal.txt")).toBe("alpha.*beta");
  expect(await run(session, "grep [x] /literal.txt")).toBe("[x] marker");
  expect(await run(session, "grep -i alpha.*beta /literal.txt")).toBe("alpha.*beta\nALPHA.*BETA");
  expect(await run(session, "grep -n plain /literal.txt")).toBe("4:plain line");
  expect(await run(session, "grep -v alpha /literal.txt")).toBe(
    "[x] marker\nplain line\nALPHA.*BETA",
  );
  expect(await run(session, "grep -n marker /literal.txt README.md")).toContain(
    "/literal.txt:3:[x] marker",
  );
  expect(await run(session, "grep")).toContain("用法：grep [option...] <pattern> <file...>");
  expect(await run(session, "grep")).toContain("可用参数：-i, -n, -v");
  expect(await run(session, "grep plain")).toContain("用法：grep [option...] <pattern> <file...>");
  expect(await run(session, "grep plain /missing")).toContain("执行失败：/missing");
});
test("sort orders lines and reverses on request", async () => {
  const session = makeSession();
  register(session, "/sortme.txt", "gamma\nalpha\nbeta\n");
  expect(await run(session, "sort /sortme.txt")).toBe("alpha\nbeta\ngamma");
  expect(await run(session, "sort -r /sortme.txt")).toBe("gamma\nbeta\nalpha");
  expect(await run(session, "sort")).toContain("用法：sort [option] <file>");
  expect(await run(session, "sort -x /sortme.txt")).toContain("用法：sort [option] <file>");
  expect(await run(session, "sort -x /sortme.txt")).toContain("可用参数：-r");
  expect(await run(session, "sort /missing")).toContain("执行失败：/missing");
});
test("tree walks the virtual directories and reports truncation", async () => {
  const session = makeSession();
  const community = await run(session, "tree /community");
  expect(community.split("\n")[0]).toBe("/community/");
  expect(community).toContain("  events.txt");
  expect(community).toContain("  handbook.txt");
  const home = await run(session, "tree");
  expect(home.split("\n")[0]).toBe("/home/guest/");
  expect(home).toContain("README.md");
  expect(home).toContain(".profile");
  expect(await run(session, "tree /etc/os-release")).toBe("/etc/os-release");
  expect(await run(session, "tree /missing")).toContain("执行失败：/missing");
  session.workspace.register({ path: "/bulk", kind: "directory" });
  for (let index = 0; index < 130; index++)
    register(session, `/bulk/file-${String(index).padStart(3, "0")}.txt`, "x");
  const truncated = await run(session, "tree /bulk");
  expect(truncated).toContain("结果超过显示上限，已截断。");
});
test("find matches names with a literal-only wildcard and lists descendants", async () => {
  const session = makeSession();
  expect(await run(session, "find /community")).toBe(
    "/community/events.txt\n/community/handbook.txt",
  );
  expect(await run(session, "find /community -name *.txt")).toBe(
    "/community/events.txt\n/community/handbook.txt",
  );
  expect(await run(session, "find / -name *.md")).toBe("/home/guest/README.md");
  expect(await run(session, "find /community -name hand*")).toBe("/community/handbook.txt");
  expect(await run(session, "find /community -name *.t?t")).toBe("");
  session.workspace.register({ path: "/tags", kind: "directory" });
  register(session, "/tags/[x].txt", "x");
  expect(await run(session, "find /tags -name [x].txt")).toBe("/tags/[x].txt");
  expect(await run(session, "find /tags -name [xz].txt")).toBe("");
  expect(await run(session, "find /missing")).toContain("执行失败：/missing");
  expect(await run(session, "find -name")).toContain("用法：find [path] [-name <pattern>]");
});
test("id reports the guest identity without host data", async () => {
  const session = makeSession();
  expect(await run(session, "id")).toBe("uid=1000(guest) gid=1000(guest) groups=1000(guest)");
  expect(await run(session, "id extra")).toContain("用法：id");
});
test("seq supports one, two and three arguments and refuses oversized output", async () => {
  const session = makeSession();
  expect(await run(session, "seq 3")).toBe("1\n2\n3");
  expect(await run(session, "seq 2 4")).toBe("2\n3\n4");
  expect(await run(session, "seq 1 2 5")).toBe("1\n3\n5");
  expect(await run(session, "seq 3 -1 1")).toBe("3\n2\n1");
  expect(await run(session, "seq 0 0.5 1")).toBe("0\n0.5\n1");
  expect(await run(session, "seq 1 1 500")).toContain("输出超过上限：最多 200 行");
  expect(await run(session, "seq a")).toContain("用法：seq [first] [step] <last>");
  expect(await run(session, "seq 1 0 5")).toContain("用法：seq [first] [step] <last>");
  expect(await run(session, "seq 1 2 3 4")).toContain("用法：seq [first] [step] <last>");
});
test("sleep stays inside five seconds and reports the range", async () => {
  const session = makeSession();
  expect(await run(session, "sleep 0")).toBe("");
  expect(await run(session, "sleep 6")).toContain("暂停时长需在 0 到 5 秒之间");
  expect(await run(session, "sleep -1")).toContain("暂停时长需在 0 到 5 秒之间");
  expect(await run(session, "sleep abc")).toContain("用法：sleep <seconds>");
  expect(await run(session, "sleep")).toContain("用法：sleep <seconds>");
});
test("wait rejects at once when its signal aborts and never later resolves", async () => {
  const controller = new AbortController();
  const pending = wait(1000, controller.signal);
  const started = performance.now();
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(performance.now() - started).toBeLessThan(200);
  await expect(wait(10, AbortSignal.abort())).rejects.toThrow();
});
test("cancelling sleep and head adds only the shared cancellation line", async () => {
  const session = makeSession();
  const sleeping = session.execute("sleep 1");
  session.cancel();
  await sleeping;
  expect(session.status).toBe(130);
  expect(session.running).toBe(false);
  expect(session.entries.at(-1)).toMatchObject({ text: "命令已取消。", tone: "error" });
  const settled = session.entries.length;
  await new Promise((done) => setTimeout(done, 60));
  expect(session.entries.length).toBe(settled);
  session.workspace.register({
    path: "/slow.txt",
    kind: "file",
    read: (signal) =>
      new Promise<string>((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      }),
  });
  const reading = session.execute("head /slow.txt");
  session.cancel();
  await reading;
  expect(session.status).toBe(130);
  expect(session.entries.at(-1)).toMatchObject({ text: "命令已取消。", tone: "error" });
});
