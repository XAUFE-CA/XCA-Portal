import { describe, expect, it, mock } from "bun:test";
import type { ContextMenuItem } from "@neoverse-ui/vue";
import { createTranslator } from "../../../i18n";
import { applyPreferenceRow, preferenceMenuEntries } from "./preferences";

const t = createTranslator(() => "zh-CN");

const submenus = (): ContextMenuItem[] =>
  preferenceMenuEntries(t, "dark", "en").filter(
    (entry): entry is ContextMenuItem => "children" in entry,
  );

describe("preference rows", () => {
  it("marks the active theme and language as the checked row", () => {
    const [theme, locale] = submenus();
    expect(theme?.label).toBe("切换主题");
    expect(theme?.children?.map((row) => [row.id, row.checked])).toEqual([
      ["theme:light", false],
      ["theme:dark", true],
      ["theme:system", false],
    ]);
    expect(locale?.label).toBe("切换语言");
    expect(locale?.children?.map((row) => [row.id, row.checked])).toEqual([
      ["locale:zh-CN", false],
      ["locale:en", true],
    ]);
  });

  it("applies known rows and leaves region rows to their own menus", () => {
    const actions = { setTheme: mock(), setLocale: mock() };

    expect(applyPreferenceRow("theme:dark", actions)).toBe(true);
    expect(actions.setTheme).toHaveBeenCalledWith("dark");
    expect(applyPreferenceRow("locale:en", actions)).toBe(true);
    expect(actions.setLocale).toHaveBeenCalledWith("en");

    // An unknown value claims the row without changing the preference.
    // 未知取值仍认领该行，但不改动偏好。
    expect(applyPreferenceRow("theme:sepia", actions)).toBe(true);
    expect(applyPreferenceRow("locale:fr", actions)).toBe(true);
    expect(actions.setTheme).toHaveBeenCalledTimes(1);
    expect(actions.setLocale).toHaveBeenCalledTimes(1);

    expect(applyPreferenceRow("copy-title", actions)).toBe(false);
    expect(applyPreferenceRow("clear-screen", actions)).toBe(false);
  });
});
