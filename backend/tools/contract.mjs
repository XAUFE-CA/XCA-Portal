import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const mode = process.argv[2];
if (mode !== "generate" && mode !== "check") {
  throw new Error("Usage: bun tools/contract.mjs generate|check");
}

const outputPath = "api/openapi.generated.ts";
const generated = execFileSync(
  process.execPath,
  ["x", "--no-install", "openapi-typescript", "api/openapi.yaml"],
  {
    encoding: "utf8",
  },
);
const formatted = execFileSync(
  process.execPath,
  ["x", "--no-install", "biome", "format", `--stdin-file-path=${outputPath}`],
  {
    encoding: "utf8",
    input: generated,
  },
);

if (mode === "generate") {
  writeFileSync(outputPath, formatted);
} else if (readFileSync(outputPath, "utf8") !== formatted) {
  throw new Error("Generated API types are stale; run bun run api:generate.");
}
