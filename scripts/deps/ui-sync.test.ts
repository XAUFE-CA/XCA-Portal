import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sources = new Map(
  ["sync-neoverse-ui.ts", "ui-dependencies.ts"].map((name) => [
    name,
    readFileSync(join(import.meta.dir, name)),
  ]),
);

const cases = [
  {
    name: "published packages skip local installation and sibling access",
    manifest: { dependencies: { "@neoverse-ui/vue": "0.3.0" } },
    code: 0,
    message: "local sync skipped",
  },
  {
    name: "mixed same-name declarations fail before installation",
    manifest: {
      dependencies: { "@neoverse-ui/vue": "file:../Neoverse-UI/packages/vue" },
      overrides: { "@neoverse-ui/vue": "0.3.0" },
    },
    code: 1,
    message: "不能混用",
  },
  {
    name: "local packages fail clearly when the sibling synchronizer is missing",
    manifest: { dependencies: { "@neoverse-ui/vue": "file:../Neoverse-UI/packages/vue" } },
    code: 1,
    message: "找不到共享同步脚本",
  },
];

for (const scenario of cases) {
  test(scenario.name, () => {
    const root = mkdtempSync(join(tmpdir(), "xca-ui-sync-"));
    const fixture = join(root, "portal");
    try {
      mkdirSync(join(fixture, "scripts", "deps"), { recursive: true });
      const manifest = `${JSON.stringify(scenario.manifest)}\n`;
      writeFileSync(join(fixture, "package.json"), manifest);
      for (const [name, source] of sources)
        writeFileSync(join(fixture, "scripts", "deps", name), source);
      const result = Bun.spawnSync([process.execPath, "scripts/deps/sync-neoverse-ui.ts"], {
        cwd: fixture,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode).toBe(scenario.code);
      expect(result.stdout.toString() + result.stderr.toString()).toContain(scenario.message);
      expect(existsSync(join(fixture, "bun.lock"))).toBe(false);
      expect(existsSync(join(fixture, "node_modules"))).toBe(false);
      expect(readFileSync(join(fixture, "package.json"), "utf8")).toBe(manifest);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
