import { expect, test } from "bun:test";
import { registerVirtualFiles } from "../client-session";
import { TerminalSession } from "./session";
import type { TerminalServices } from "./types";

const services = (): TerminalServices => ({
  navigate: () => {},
  getTheme: () => "system",
  setTheme: () => {},
  replayIntro: () => {},
});
const makeSession = () => {
  const session = new TerminalSession(services());
  registerVirtualFiles(session);
  return session;
};
test("walk collects every descendant in path order and treats files as leaves", () => {
  const session = makeSession();
  const paths = session.workspace.walk("/").map((node) => node.path);
  expect(paths).toContain("/community/handbook.txt");
  expect(paths).toContain("/home/guest/README.md");
  expect(paths).toContain("/etc/motd");
  expect(paths).not.toContain("/");
  expect([...paths].sort()).toEqual(paths);
  expect(session.workspace.walk("/etc/os-release")).toEqual([]);
  expect(session.workspace.walk("/community").map((node) => node.path)).toEqual([
    "/community/events.txt",
    "/community/handbook.txt",
  ]);
});
test("walk follows nested directories from the current working directory", () => {
  const session = makeSession();
  session.workspace.register({ path: "/nested", kind: "directory" });
  session.workspace.register({ path: "/nested/inner", kind: "directory" });
  session.workspace.register({ path: "/nested/inner/leaf.txt", kind: "file", read: () => "leaf" });
  expect(session.workspace.walk("/nested").map((node) => node.path)).toEqual([
    "/nested/inner",
    "/nested/inner/leaf.txt",
  ]);
  session.workspace.cd("/nested");
  expect(session.workspace.walk().map((node) => node.path)).toEqual([
    "/nested/inner",
    "/nested/inner/leaf.txt",
  ]);
  expect(session.workspace.list("/nested").map((node) => node.path)).toEqual(["/nested/inner"]);
});
test("workspace reads refuse a missing path and an aborted signal", async () => {
  const session = makeSession();
  await expect(session.workspace.read("/missing", new AbortController().signal)).rejects.toThrow(
    "/missing",
  );
  await expect(session.workspace.read("/etc/motd", AbortSignal.abort())).rejects.toThrow();
});
