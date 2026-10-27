import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
});

test("home uses token-driven, non-interactive atmosphere that never covers the terminal", async ({
  page,
}) => {
  const atmosphere = page.locator(".site-atmosphere");
  const light = page.locator(".site-atmosphere__light");
  const depth = page.locator(".site-atmosphere__depth");

  await expect(atmosphere).toHaveClass(/site-atmosphere--home/);
  await expect(atmosphere).toHaveAttribute("aria-hidden", "true");
  await expect(light).toHaveCount(1);
  await expect(depth).toHaveCount(1);
  await expect(page.locator(".site-atmosphere svg, .site-atmosphere__grid")).toHaveCount(0);

  for (const theme of ["dark", "light"]) {
    await page.getByRole("radio", { name: theme === "dark" ? "深色" : "浅色" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const appearance = await atmosphere.evaluate((element) => {
      const background = getComputedStyle(element);
      const light = element.querySelector<HTMLElement>(".site-atmosphere__light");
      const depth = element.querySelector<HTMLElement>(".site-atmosphere__depth");
      if (!light || !depth) throw new Error("Home atmosphere must contain light and depth layers");
      const lightStyle = getComputedStyle(light);
      const depthStyle = getComputedStyle(depth);
      return {
        pointerEvents: background.pointerEvents,
        background: background.backgroundImage,
        light: lightStyle.backgroundImage,
        depth: depthStyle.backgroundImage,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(appearance.pointerEvents).toBe("none");
    expect(appearance.light).toContain("radial-gradient");
    expect(appearance.depth).toContain("radial-gradient");
    expect(appearance.overflowX).toBeLessThanOrEqual(0);
  }

  const input = page.locator("#xca-command-input");
  await input.fill("echo background-ok");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("background-ok");
});

test("home background remains contained on narrow viewports and after reload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".site-atmosphere__light")).toBeVisible();
  await expect(page.locator(".site-atmosphere__depth")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);

  await page.reload();
  await expect(page.locator(".site-atmosphere")).toHaveClass(/site-atmosphere--home/);
  await expect(page.locator(".site-atmosphere__light")).toHaveCount(1);
});

test("both themes render perceptible ambient light, not just gradient CSS declarations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [label, theme] of [
    ["深色", "dark"],
    ["浅色", "light"],
  ] as const) {
    await page.getByRole("radio", { name: label }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const screenshot = await page.screenshot({ type: "jpeg", quality: 90 });
    const contrasts = await page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = `data:image/jpeg;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("A 2D canvas context is required to sample the screenshot");
      context.drawImage(image, 0, 0);
      const shell = document.querySelector(".site-shell");
      if (!shell) throw new Error("The site shell is required to measure background contrast");
      const channels = getComputedStyle(shell).backgroundColor.match(/[\d.]+/g);
      if (!channels) throw new Error("The site shell background must expose color channels");
      const base = channels.slice(0, 3).map(Number);
      return [
        [0.05, 0.76],
        [0.95, 0.24],
        [0.95, 0.72],
      ].map(([x, y]) => {
        const pixels = context.getImageData(
          Math.round(image.naturalWidth * x),
          Math.round(image.naturalHeight * y),
          1,
          1,
        ).data;
        return Math.max(
          ...base.map((channel, index) => {
            const pixel = pixels[index];
            if (pixel === undefined)
              throw new Error(`Screenshot color channel ${index} is missing`);
            return Math.abs(channel - pixel);
          }),
        );
      });
    }, screenshot.toString("base64"));
    expect(
      contrasts.filter((difference) => difference > 14).length,
      `${theme} homepage should contain a perceptible light field`,
    ).toBeGreaterThanOrEqual(2);
  }
});
