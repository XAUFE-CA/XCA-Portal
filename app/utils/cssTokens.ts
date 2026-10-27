/**
 * Resolve lengths through CSS so clamp(), rem, and aliases use the browser's actual geometry.
 * 通过 CSS 解析长度，使 clamp()、rem 与别名使用浏览器真实几何。
 */
export function tokenLength(element: HTMLElement, token: `--neoverse-${string}`): number {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:var(${token});height:0`;
  element.append(probe);
  try {
    return parseFloat(getComputedStyle(probe).width);
  } finally {
    probe.remove();
  }
}
