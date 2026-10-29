import { tokenLength } from "~/utils/cssTokens";
import type { IntroAnimate } from "./intro-journey";
import { terminalDockFrames } from "./intro-journey";
import { expressiveDuration, INTRO_PACING } from "./timing";

const VISIT_KEY = "xca-intro-seen";
let visitedInDocument = false;

export function claimFirstHomeVisit(): boolean {
  let seen = visitedInDocument;
  visitedInDocument = true;
  try {
    seen ||= localStorage.getItem(VISIT_KEY) === "1";
    localStorage.setItem(VISIT_KEY, "1");
  } catch {
    // Keep client navigation usable when browser storage is unavailable.
    // 浏览器存储不可用时，仍保留客户端导航的访问记录。
  }
  return !seen;
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
  const frames = visible
    ? terminalDockFrames(new DOMMatrixReadOnly(style.transform).toFloat64Array())
    : [{ transform: "translateZ(0)" }, { transform: "translateZ(0)" }];
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
