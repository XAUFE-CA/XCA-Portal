import type { ContextMenuEntry } from "@neoverse-ui/vue";
import { type ComputedRef, computed, onBeforeUnmount, type Ref, ref, shallowRef } from "vue";
import type { MenuPoint } from "../core/menu-model";
import { attachRegionListeners, keepsNativeMenuByDefault } from "./region-listeners";

/** A row action reports a short status line, or nothing when it has no visible result. */
export type ContextMenuResult = string | undefined | Promise<string | undefined>;

export interface ContextMenuConfig {
  /** Accessible name of the panel, already localized by the region. */
  label: () => string;
  /** Entries for the element the visitor right-clicked; `null` when the event has no element. */
  entries: (target: Element | null) => ContextMenuEntry[];
  /** Runs the chosen row; the original target lets a region act on the clicked link. */
  select: (id: string, target: Element | null) => ContextMenuResult;
  /** Text fields inside this region keep the browser menu unless they opt in here. */
  keepNativeMenu?: (target: Element | null) => boolean;
}

export interface ContextMenuState {
  isOpen: Ref<boolean>;
  point: Ref<MenuPoint>;
  focusReturn: Ref<HTMLElement | null>;
  entries: ComputedRef<ContextMenuEntry[]>;
  label: ComputedRef<string>;
  /** Transient confirmation text; empty while no action has reported a result. */
  status: Ref<string>;
  /**
   * Whether the panel takes focus on open. A pointer open keeps the region's focus so an
   * editor keeps its selection highlight; a keyboard open must move focus into the panel.
   * 面板打开时是否接管焦点。指针打开保留区域焦点，编辑器因此保留选区高亮；键盘打开必须把焦点移入面板。
   */
  autoFocus: Ref<boolean>;
  /** Bind to the region element; the listeners attach and detach with it. */
  regionRef: RegionRef;
  select: (id: string) => void;
  announce: (text: string) => void;
}

/** Template ref shape Vue hands to a function ref on a DOM element. */
export type RegionRef = (element: Element | object | null) => void;

const STATUS_TIMEOUT = 2400;

/**
 * One region's context-menu state. The region binds `regionRef` and renders the shared
 * `UiContextMenu` through `ContextMenuHost`, so every region shares pointer anchoring,
 * keyboard opens, touch long press and focus restoration.
 * 单个区域的上下文菜单状态。区域绑定 regionRef，并通过 ContextMenuHost 渲染共享的
 * UiContextMenu，因此各区域共用指针锚定、键盘打开、触屏长按与焦点恢复。
 */
export function useContextMenu(config: ContextMenuConfig): ContextMenuState {
  const isOpen = ref(false);
  const point = ref<MenuPoint>({ x: 0, y: 0 });
  // Keep the clicked element as the focus return target: a cursor open has no trigger.
  // 保留被点击的元素作为焦点返回目标。指针打开没有触发器。
  const focusReturn = shallowRef<HTMLElement | null>(null);
  const target = shallowRef<Element | null>(null);
  const status = ref("");
  const autoFocus = ref(true);
  // Bumped on every open so rows reflect the state at open time, not at first mount.
  // 每次打开都递增，使菜单项反映打开时的状态，而不是首次挂载时的状态。
  const openRevision = ref(0);
  const entries = computed(() => {
    openRevision.value;
    return config.entries(target.value);
  });
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let detach: (() => void) | undefined;

  /**
   * Show a short confirmation near the anchor. It clears on its own so a region never
   * accumulates a second content channel.
   * 在锚点附近显示短暂确认。它会自动清除，区域因此不会积累第二个内容通道。
   */
  function announce(text: string) {
    status.value = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (status.value = ""), STATUS_TIMEOUT);
  }

  function openAt(anchor: MenuPoint, element: Element | null, takeFocus = false) {
    target.value = element;
    focusReturn.value = element instanceof HTMLElement ? element : null;
    point.value = anchor;
    autoFocus.value = takeFocus;
    openRevision.value += 1;
    isOpen.value = true;
  }

  // Listeners live on the region element rather than in template attributes: a touch
  // long press needs four pointer listeners that have no meaningful template shorthand.
  // 监听器挂在区域元素上而不是模板属性上：触屏长按需要四个指针监听，模板简写并不适用。
  const regionRef: RegionRef = (element) => {
    detach?.();
    detach = undefined;
    if (!(element instanceof HTMLElement)) return;
    detach = attachRegionListeners(element, {
      open: (anchor, target, takeFocus) => openAt(anchor, target, takeFocus),
      keepNativeMenu: config.keepNativeMenu ?? keepsNativeMenuByDefault,
    });
  };

  function select(id: string) {
    isOpen.value = false;
    const result = config.select(id, target.value);
    // Copy actions resolve asynchronously; the status line follows the real outcome.
    // 复制操作异步返回，状态行跟随真实结果。
    if (result instanceof Promise) void result.then((text) => text && announce(text));
    else if (result) announce(result);
  }

  onBeforeUnmount(() => {
    clearTimeout(statusTimer);
    detach?.();
    detach = undefined;
  });

  return {
    isOpen,
    point,
    focusReturn,
    entries,
    label: computed(config.label),
    status,
    autoFocus,
    regionRef,
    select,
    announce,
  };
}
