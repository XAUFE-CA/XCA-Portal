import { expect, test } from "@playwright/test";
import {
  openContextMenuAt as openAt,
  contextMenuPanel as panel,
  useContextMenuPage,
} from "../support/context-menu";

// Panel rows beyond links and copies: appearance preferences, shared site preferences and the
// surface guard that keeps the browser menu away from the panel itself.
// 链接与复制之外的菜单行：外观偏好、共用站点偏好，以及让浏览器菜单不落在面板上的表面守卫。
test.beforeEach(async ({ page }) => {
  await useContextMenuPage(page);
});

test("terminal menu switches the background through a submenu and the appearance command", async ({
  page,
}) => {
  await openAt(page, page.locator(".xca-terminal-anchor"));
  const backgroundRow = panel(page).getByRole("menuitem", { name: "切换终端背景" });
  await expect(backgroundRow).toHaveAttribute("aria-haspopup", "menu");
  await backgroundRow.click();

  const submenu = page.locator(".ui-context-menu__submenu:visible");
  const radio = submenu.getByRole("menuitemradio", { name: "纯净" });
  await expect(radio).toHaveAttribute("aria-checked", "false");
  await radio.click();

  await openAt(page, page.locator(".xca-terminal-anchor"));
  await panel(page).getByRole("menuitem", { name: "切换终端背景" }).click();
  await expect(
    page.locator(".ui-context-menu__submenu:visible").getByRole("menuitemradio", { name: "纯净" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("terminal-specific rows stay in one group above site actions and preferences", async ({
  page,
}) => {
  await openAt(page, page.locator(".xca-terminal-anchor"));
  const labels = await panel(page).locator(".ui-context-menu__item").allTextContents();
  const group = [
    "复制选中内容",
    "粘贴",
    "复制最后一条命令",
    "清屏",
    "清除命令历史",
    "切换终端背景",
    "展开终端",
  ];
  const indices = group.map((label) => labels.findIndex((text) => text.startsWith(label)));
  // Consecutive indices mean no separator splits the control-specific group.
  // 连续索引说明没有分隔线拆开控件专属分组。
  expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6]);
  const site = labels.findIndex((text) => text.startsWith("重播入场动画"));
  const preferences = labels.findIndex((text) => text.startsWith("切换主题"));
  const native = labels.findIndex((text) => text.startsWith("显示原生菜单"));
  expect(site).toBeGreaterThan(indices.at(-1) ?? -1);
  expect(preferences).toBeGreaterThan(site);
  expect(native).toBeGreaterThan(preferences);
});

test("the panel and its submenu keep the browser menu out", async ({ page }) => {
  await page.evaluate(() => {
    const prevented: boolean[] = [];
    Object.assign(window, { xcaContextMenuPrevented: prevented });
    // The guard is a document capture listener registered before this probe, so the same
    // phase reports the prevented state synchronously.
    // 守卫是比本探针更早注册的文档捕获监听，因此同一阶段即可同步读到阻止状态。
    document.addEventListener(
      "contextmenu",
      (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest('[popover][role="menu"]')) {
          prevented.push(event.defaultPrevented);
        }
      },
      true,
    );
  });

  await openAt(page, page.locator(".xca-terminal-anchor"));
  const row = panel(page).getByRole("menuitem", { name: "清屏" });
  let box = await row.boundingBox();
  if (box === null) throw new Error("Menu row must be laid out");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await expect(panel(page)).toBeVisible();

  await panel(page).getByRole("menuitem", { name: "切换主题" }).click();
  const submenuRow = page
    .locator(".ui-context-menu__submenu:visible")
    .getByRole("menuitemradio")
    .first();
  box = await submenuRow.boundingBox();
  if (box === null) throw new Error("Submenu row must be laid out");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await expect(page.locator(".ui-context-menu__submenu:visible")).toBeVisible();

  const prevented = await page.evaluate(
    () => (window as unknown as { xcaContextMenuPrevented: boolean[] }).xcaContextMenuPrevented,
  );
  expect(prevented).toEqual([true, true]);
});

test("terminal and about menus carry the shared theme and language rows", async ({ page }) => {
  await openAt(page, page.locator(".xca-terminal-anchor"));
  const themeRow = panel(page).getByRole("menuitem", { name: "切换主题" });
  await expect(themeRow).toHaveAttribute("aria-haspopup", "menu");
  await expect(panel(page).getByRole("menuitem", { name: "切换语言" })).toHaveAttribute(
    "aria-haspopup",
    "menu",
  );

  await themeRow.click();
  const themeMenu = page.locator(".ui-context-menu__submenu:visible");
  await expect(themeMenu.getByRole("menuitemradio", { name: "系统" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await themeMenu.getByRole("menuitemradio", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto("/about", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".about-card")).toBeVisible();
  await openAt(page, page.locator(".about-page"));
  await expect(panel(page)).toHaveAttribute("aria-label", "关于学社操作");
  const aboutTheme = panel(page).getByRole("menuitem", { name: "切换主题" });
  await expect(aboutTheme).toHaveAttribute("aria-haspopup", "menu");
  await aboutTheme.click();
  await expect(
    page.locator(".ui-context-menu__submenu:visible").getByRole("menuitemradio", { name: "深色" }),
  ).toHaveAttribute("aria-checked", "true");
});
