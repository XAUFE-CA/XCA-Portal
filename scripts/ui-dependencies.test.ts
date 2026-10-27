import { expect, test } from "bun:test";
import { uiDependencyState } from "./ui-dependencies";

test("UI dependency state distinguishes local, published and mixed sources", () => {
  const manifest = (specifier: string) => ({
    dependencies: { "@neoverse-ui/vue": specifier },
    overrides: { "@neoverse-ui/vue": specifier },
  });
  expect(uiDependencyState(manifest("file:../Neoverse-UI/packages/vue"))).toBe("local");
  expect(uiDependencyState(manifest("0.4.0"))).toBe("published");
  expect(
    uiDependencyState({
      dependencies: { "@neoverse-ui/vue": "file:../Neoverse-UI/packages/vue" },
      overrides: { "@neoverse-ui/tokens": "0.4.0" },
    }),
  ).toBe("mixed");
});

test("same-name overrides cannot hide a mixed dependency source", () => {
  for (const [dependency, override] of [
    ["file:../Neoverse-UI/packages/vue", "0.3.0"],
    ["0.3.0", "file:../Neoverse-UI/packages/vue"],
  ])
    expect(
      uiDependencyState({
        dependencies: { "@neoverse-ui/vue": dependency },
        overrides: { "@neoverse-ui/vue": override },
      }),
    ).toBe("mixed");
});

test("non-UI dependencies and absent maps do not require local synchronization", () => {
  expect(uiDependencyState({})).toBe("published");
  expect(uiDependencyState({ dependencies: { vue: "3.5.44" } })).toBe("published");
  expect(
    uiDependencyState({ overrides: { "@neoverse-ui/vue": "file:../Neoverse-UI/packages/vue" } }),
  ).toBe("local");
});
