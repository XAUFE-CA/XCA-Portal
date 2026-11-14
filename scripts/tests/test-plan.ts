import { checkRegistry, LEVELS, type TestLevel, type TestScope } from "./test-registry";

const USAGE =
  "usage: bun scripts/tests/test-plan.ts <list|run> <unit,module|system> " +
  "[--scene] [--snapshot] [--no-snapshot] [--shard=N/M] [--ignore-snapshots] [--update-snapshots]";

function reject(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

interface PlanFlags {
  scene: boolean;
  snapshot: boolean;
  noSnapshot: boolean;
  shard?: string;
  ignoreSnapshots: boolean;
  updateSnapshots: boolean;
}

function parseFlags(values: string[]): PlanFlags {
  const flags: PlanFlags = {
    scene: false,
    snapshot: false,
    noSnapshot: false,
    ignoreSnapshots: false,
    updateSnapshots: false,
  };
  for (const value of values) {
    if (value === "--scene") flags.scene = true;
    else if (value === "--snapshot") flags.snapshot = true;
    else if (value === "--no-snapshot") flags.noSnapshot = true;
    else if (value === "--ignore-snapshots") flags.ignoreSnapshots = true;
    else if (value === "--update-snapshots") flags.updateSnapshots = true;
    else if (value.startsWith("--shard=")) {
      const shard = value.slice("--shard=".length);
      if (!/^\d+\/\d+$/.test(shard)) reject(`invalid shard ${shard}`);
      flags.shard = shard;
    } else reject(`unknown flag ${value}`);
  }
  if (flags.snapshot && flags.noSnapshot) reject("--snapshot and --no-snapshot conflict");
  if (flags.ignoreSnapshots && flags.updateSnapshots)
    reject("--ignore-snapshots and --update-snapshots conflict");
  return flags;
}

function selectScopes(scopes: TestScope[], levels: TestLevel[], flags: PlanFlags): TestScope[] {
  return scopes.filter((scope) => {
    if (!levels.includes(scope.level)) return false;
    if (flags.scene && !scope.metadata.includes("scene")) return false;
    if (flags.snapshot && !scope.metadata.includes("snapshot")) return false;
    if (flags.noSnapshot && scope.metadata.includes("snapshot")) return false;
    return true;
  });
}

function runnerCommand(
  runner: TestScope["runner"],
  files: string[],
  flags: PlanFlags,
  extra: string[],
): string[] {
  if (runner === "bun-test") {
    if (flags.scene || flags.snapshot || flags.noSnapshot)
      reject("scene and snapshot selection apply to playwright only");
    return ["bun", "test", ...files, ...extra];
  }
  return [
    "bunx",
    "playwright",
    "test",
    ...files,
    ...extra,
    flags.scene ? "--grep=@cinematic" : "--grep-invert=@cinematic",
    ...(flags.shard ? [`--shard=${flags.shard}`] : []),
    ...(flags.ignoreSnapshots ? ["--ignore-snapshots"] : []),
    ...(flags.updateSnapshots ? ["--update-snapshots"] : []),
  ];
}

const [command, levelArg, ...rest] = process.argv.slice(2);
if (command !== "list" && command !== "run") reject("expected list or run");
if (!levelArg) reject("missing level");
const levels = levelArg.split(",");
for (const level of levels)
  if (!(LEVELS as readonly string[]).includes(level)) reject(`unknown level ${level}`);
const flags = parseFlags(rest);

const report = await checkRegistry();
if (report.issues.length) {
  console.error(report.issues.join("\n"));
  process.exit(1);
}
const selected = selectScopes(report.scopes, levels as TestLevel[], flags);
const files = [...new Set(selected.flatMap((scope) => scope.files))].sort();
if (files.length === 0) reject("no test files selected");
const runners = new Set(selected.map((scope) => scope.runner));
if (runners.size > 1) reject("one plan cannot mix bun-test and playwright scopes");
const [runner] = runners;
if (!runner) reject("no runner selected");
const extra = [...new Set(selected.flatMap((scope) => scope.args))];
const cmd = runnerCommand(runner, files, flags, extra);

if (command === "list") {
  for (const scope of selected)
    console.log(
      `${scope.level.padEnd(6)} ${scope.runner.padEnd(10)} ${scope.files.length}  ${scope.scope}`,
    );
  console.log(`\n${cmd.join(" ")}`);
} else {
  const env = flags.scene ? { ...process.env, XCA_CINEMATIC: "1" } : process.env;
  const proc = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit", env });
  process.exitCode = proc.exitCode ?? 1;
}
