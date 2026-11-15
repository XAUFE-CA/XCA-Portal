// Both the panel and its submenu are top-layer popovers: the panel can sit beside the region
// that owns it, and the submenu is teleported to the body, so no region listener sees a
// right-click that lands on a row.
// 面板及其二级菜单都是顶层浮层：面板可能位于所属区域之外，二级菜单被传送到 body，
// 因此没有区域监听能收到落在菜单行上的右键。
const MENU_SURFACE = '[popover][role="menu"]';

let guards = 0;
let detach: (() => void) | undefined;

function onContextMenu(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element) || target.closest(MENU_SURFACE) === null) return;
  // A menu row has no browser-menu equivalent; keep the custom panel open instead of letting
  // the native menu replace it.
  // 菜单行没有对应的浏览器菜单项；保留自定义面板，而不是让原生菜单顶替它。
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Keep the browser menu away from every custom menu surface mounted in this document. Each
 * host takes one reference so several hosts share a single document listener.
 * 让浏览器菜单不落在文档内的任何自定义菜单表面上。每个宿主持有一个引用，多个宿主因此共用一个文档监听。
 */
export function guardMenuSurface(document: Document): () => void {
  if (guards === 0) {
    document.addEventListener("contextmenu", onContextMenu, true);
    detach = () => document.removeEventListener("contextmenu", onContextMenu, true);
  }
  guards += 1;
  let active = true;

  return () => {
    if (!active) return;
    active = false;
    guards -= 1;
    if (guards > 0) return;
    detach?.();
    detach = undefined;
  };
}
