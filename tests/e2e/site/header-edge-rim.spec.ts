import { expect, type Page, test } from "@playwright/test";
import { useBriefEntry } from "../support/entry";

test.beforeEach(async ({ page }) => {
  await useBriefEntry(page);
});

// The header borrows the shared Aurora Glass stroke instead of painting its own:
// its silhouette keeps the card radius on the bottom edge at the page top, so the
// library closes the same stroke in both states.
// 顶栏的描边由共享极光玻璃绘制，门户不自绘：静止时轮廓底部保留卡片圆角，使两种状态闭合同一段描边。

function headerRadius(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector(".site-header");
    if (!header) throw new Error("The site header is required to read its radius");
    return getComputedStyle(header).borderRadius;
  });
}

function rootValue(page: Page, property: string) {
  return page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    property,
  );
}

async function makeScrollable(page: Page) {
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.style.height = "1600px";
    document.querySelector(".site-main")?.append(spacer);
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
      ),
    )
    .toBeGreaterThan(200);
}

test("the page-top header keeps the shared card radius on its bottom edge", async ({ page }) => {
  await page.goto("/about");
  await expect(page.locator(".site-header")).toBeVisible();
  await makeScrollable(page);

  const card = await rootValue(page, "--neoverse-radius-card");
  expect(card).not.toBe("");

  // The bottom edge is already a card edge before the bar detaches.
  // 顶栏尚未收拢时，底部就已经是卡片边缘。
  await expect.poll(() => headerRadius(page)).toBe(`0px 0px ${card} ${card}`);

  await page.evaluate(() => window.scrollTo({ top: 240, behavior: "instant" }));
  await expect(page.locator(".site-header-wrap")).toHaveClass(/floating/);
  await expect.poll(() => headerRadius(page)).toBe(card);
});

test("the header takes the shared painted stroke instead of its own edge", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/about");
  await expect(page.locator(".site-header")).toBeVisible();

  const state = await page.evaluate(() => {
    const header = document.querySelector(".site-header");
    if (!header) throw new Error("The site header is required to inspect its stroke");
    const style = getComputedStyle(header);
    return {
      optsIn: header.hasAttribute("data-neoverse-glass-edge-stroke"),
      edgePass: header.getAttribute("data-neoverse-glass-edge-pass"),
      localRim: style.getPropertyValue("--xca-header-edge-rim").trim(),
      stroke: style.getPropertyValue("--neoverse-material-edge-stroke").trim(),
      shadow: style.boxShadow,
      rim: style.getPropertyValue("--neoverse-material-edge-refraction-opacity").trim(),
      material: style
        .getPropertyValue("--neoverse-material-glass-elevated-edge-refraction-opacity")
        .trim(),
    };
  });

  // The stroke is the material's own token; the portal only opts in.
  // 描边取自材质 token，门户只做启用。
  expect(state.optsIn).toBe(true);
  expect(state.edgePass).toBeNull();
  expect(state.localRim).toBe("");
  expect(state.stroke).not.toBe("");
  expect(state.stroke).not.toBe("0 0 transparent");
  expect(state.shadow).toContain("inset");
  expect(state.rim).toBe(state.material);
});
