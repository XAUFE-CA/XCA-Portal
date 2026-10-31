import { type Page, test } from "@playwright/test";

export async function setThemePreference(page: Page, theme: string) {
  if (theme !== "light" && theme !== "dark" && theme !== "system") {
    throw new Error(`Unsupported theme fixture: ${theme}`);
  }
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("Theme persistence needs the test origin");
  await page.context().addCookies([{ name: "xca-theme", value: theme, url: baseURL }]);
}
