import { tokenLength } from "~/utils/cssTokens";
import { expressiveDuration } from "~/utils/motion";
import type { IntroAnimate } from "./intro-journey";
import { terminalDockFrames } from "./intro-journey";
import { INTRO_PACING } from "./timing";

const SESSION_KEY = "xca-intro-session";
const LEGACY_KEY = "xca-intro-seen";
let entryResolved = false;
let entryIsHome = false;
let homeIntroClaimed = false;

// Records the document as the session entry; only a home entry keeps the full intro.
// 将本次文档加载记为会话入口。只有从首页进入才保留完整入场。
export function markSessionEntry(pathname: string): void {
  if (entryResolved) return;
  entryResolved = true;
  let first = true;
  try {
    first = sessionStorage.getItem(SESSION_KEY) !== "1";
    sessionStorage.setItem(SESSION_KEY, "1");
    // The previous permanent visit record is superseded by the session entry.
    // 先前的永久访问记录由按会话的入口记录取代。
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Unavailable storage keeps the decision for this document only.
    // 存储不可用时的判定只在本文档内有效。
  }
  entryIsHome = first && pathname === "/";
}

// Grants the full intro to the session's home entry, once per document.
// 完整入场只授予会话的首页入口，每个文档仅一次。
export function claimHomeIntro(): boolean {
  if (homeIntroClaimed) return false;
  homeIntroClaimed = true;
  // On a slow device the presentation can mount before the client plugin records the entry,
  // and waiting for it would silently downgrade the first visit to the brief entry.
  // 在慢速设备上，展示层可能先于客户端插件记录入口而挂载；等它就会把首次访问静默降级为短入场。
  if (!entryResolved && typeof window !== "undefined") markSessionEntry(window.location.pathname);
  return entryIsHome;
}

export function createIntroShortcut(skip: () => void) {
  let presses: number[] = [];
  return (event: KeyboardEvent) => {
    if (
      event.code !== "Space" ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.isComposing ||
      (event.target instanceof Element &&
        event.target.closest(
          "input, textarea, select, button, a, [contenteditable]:not([contenteditable='false'])",
        ))
    ) {
      presses = [];
      return;
    }
    event.preventDefault();
    if (event.repeat) return;
    presses = presses.filter((time) => event.timeStamp - time <= 700);
    presses.push(event.timeStamp);
    if (presses.length < 3) return;
    presses = [];
    skip();
  };
}

export function entryTerminalFrames(element: HTMLElement, brief: boolean): Keyframe[] {
  if (brief) {
    const distance = tokenLength(element, "--neoverse-motion-distance-far");
    return [
      { transform: `translate3d(0, ${distance}px, 0) scale(0.98)`, opacity: 0 },
      { transform: "translateZ(0)", opacity: 1 },
    ];
  }
  const style = getComputedStyle(element);
  const visible = style.visibility !== "hidden" && Number(style.opacity) > 0;
  const opacity = visible ? Number(style.opacity) : 0;
  const frames: Keyframe[] = visible
    ? terminalDockFrames(new DOMMatrixReadOnly(style.transform).toFloat64Array())
    : [{ transform: "translateZ(0)" }, { transform: "translateZ(0)" }];
  // Restore the shared filter on the docking timeline, not when the printed intro becomes ready.
  // 共享滤镜随归位时间线恢复，不等到打印入场结束后才切换。
  const targetFilter = window.matchMedia("(prefers-reduced-transparency: reduce)").matches
    ? "none"
    : "var(--neoverse-material-filter-elevated)";
  frames[0] = {
    ...frames[0],
    backdropFilter: style.backdropFilter || "none",
    webkitBackdropFilter:
      style.getPropertyValue("-webkit-backdrop-filter") || style.backdropFilter || "none",
  };
  frames[frames.length - 1] = {
    ...frames[frames.length - 1],
    backdropFilter: targetFilter,
    webkitBackdropFilter: targetFilter,
  };
  return frames.map((frame, index) => ({
    ...frame,
    opacity: opacity + ((1 - opacity) * index) / (frames.length - 1),
    visibility: "visible",
  }));
}

export function playEntryTransition(
  element: HTMLElement,
  scene: HTMLElement | null,
  frames: Keyframe[],
  animate: IntroAnimate,
  signal: AbortSignal,
  brief = false,
): Promise<unknown> {
  const unit = expressiveDuration(element);
  const options: KeyframeAnimationOptions = {
    duration: unit * (brief ? INTRO_PACING.briefEnter : 1),
    easing: brief
      ? getComputedStyle(element).getPropertyValue("--neoverse-motion-easing-emphasized").trim()
      : "linear",
    fill: "both",
  };
  const surroundings = brief
    ? [
        {
          node: element
            .closest(".xca-terminal-hero")
            ?.querySelector<HTMLElement>(".xca-terminal-hero__heading"),
          offset: 1,
          delay: (unit * INTRO_PACING.briefStagger) / 2,
        },
      ]
    : [];
  return Promise.all([
    animate(
      element,
      frames,
      { ...options, delay: brief ? unit * INTRO_PACING.briefStagger : 0 },
      signal,
    ),
    ...surroundings.flatMap(({ node, offset, delay }) =>
      node
        ? [
            animate(
              node,
              [
                {
                  opacity: 0,
                  transform: `translate3d(0, ${offset * tokenLength(node, "--neoverse-motion-distance-mid")}px, 0)`,
                },
                { opacity: 1, transform: "translateZ(0)" },
              ],
              { ...options, delay },
              signal,
            ),
          ]
        : [],
    ),
    ...(scene
      ? [
          animate(
            scene,
            [{ opacity: getComputedStyle(scene).opacity }, { opacity: 0 }],
            options,
            signal,
          ),
        ]
      : []),
  ]);
}
