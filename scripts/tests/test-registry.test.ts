import { expect, test } from "bun:test";
import {
  coverageIssues,
  metadataIssues,
  parseRegistry,
  REGISTRY_PATH,
  type TestLevel,
  type TestMetadata,
  type TestRunner,
  type TestScope,
} from "./test-registry";

function scope(overrides: Partial<TestScope> = {}): TestScope {
  return {
    scope: "app/**/*.test.ts",
    level: "unit" as TestLevel,
    runner: "bun-test" as TestRunner,
    args: [],
    metadata: [] as TestMetadata[],
    files: ["app/example.test.ts"],
    ...overrides,
  };
}

function source(rows: string[]): string {
  return [
    "| Scope | Level | Runner | Args | Metadata |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

test("parses the table into scopes, flags and metadata", () => {
  const parsed = parseRegistry(
    source([
      "| app/example.test.ts | unit | bun-test | — | — |",
      "| tests/e2e/**/*.spec.ts | system | playwright | --workers=1 | browser, scene |",
    ]),
  );
  expect(parsed.issues).toEqual([]);
  expect(parsed.scopes).toEqual([
    {
      scope: "app/example.test.ts",
      level: "unit",
      runner: "bun-test",
      args: [],
      metadata: [],
      files: [],
    },
    {
      scope: "tests/e2e/**/*.spec.ts",
      level: "system",
      runner: "playwright",
      args: ["--workers=1"],
      metadata: ["browser", "scene"],
      files: [],
    },
  ]);
});

test("rejects unknown levels, runners and incompatible pairings", () => {
  const parsed = parseRegistry(
    source([
      "| app/example.test.ts | integration | bun-test | — | — |",
      "| tests/e2e/**/*.spec.ts | unit | playwright | — | — |",
      "| tests/e2e/**/*.spec.ts | system | vitest | — | — |",
    ]),
  );
  expect(parsed.scopes).toEqual([]);
  expect(parsed.issues).toContain(`${REGISTRY_PATH}:3: unknown level integration`);
  expect(parsed.issues).toContain(
    `${REGISTRY_PATH}:4: playwright scopes must use the system level`,
  );
  expect(parsed.issues).toContain(`${REGISTRY_PATH}:5: unknown runner vitest`);
});

test("requires metadata evidence in both directions", () => {
  const cinematic = new Map([
    ["tests/e2e/intro/example.spec.ts", 'test("scene @cinematic", async () => {});'],
  ]);
  const withScene = scope({
    scope: "tests/e2e/intro/*.spec.ts",
    level: "system",
    runner: "playwright",
    metadata: ["browser", "scene"],
    files: ["tests/e2e/intro/example.spec.ts"],
  });
  expect(metadataIssues(withScene, cinematic)).toEqual([]);
  expect(metadataIssues({ ...withScene, metadata: ["browser"] }, cinematic)).toEqual([
    "tests/e2e/intro/*.spec.ts: @cinematic tag needs metadata scene",
  ]);
  expect(metadataIssues({ ...withScene, metadata: ["browser", "snapshot"] }, cinematic)).toEqual([
    "tests/e2e/intro/*.spec.ts: @cinematic tag needs metadata scene",
    "tests/e2e/intro/*.spec.ts: metadata snapshot needs toHaveScreenshot()",
  ]);
});

test("reports unregistered and doubly registered test files", () => {
  expect(
    coverageIssues(
      [
        scope({ scope: "first", files: ["app/shared.test.ts"] }),
        scope({ scope: "second", files: ["app/shared.test.ts", "app/other.test.ts"] }),
      ],
      ["app/shared.test.ts", "app/other.test.ts", "app/missing.test.ts"],
    ),
  ).toEqual([
    "app/shared.test.ts: registered by first, second",
    `app/missing.test.ts: test file is not registered in ${REGISTRY_PATH}`,
  ]);
});
