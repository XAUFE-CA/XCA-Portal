import { bindShortcut, createIntroContext } from "./intro-runtime";
import { registerLifecycle, skipIntro, startIntro, toggleExpanded } from "./intro-sequence";

export function useIntroPresentation(getCommandCount: () => number) {
  const context = createIntroContext(getCommandCount);
  context.state.skip = () => skipIntro(context);
  bindShortcut(context);
  registerLifecycle(context);
  return {
    phase: context.phase,
    revealing: context.revealing,
    introScene: context.introScene,
    markStage: context.markStage,
    bootLines: context.bootLines,
    bootProgress: context.bootProgress,
    bannerRowsVisible: context.bannerRowsVisible,
    bannerCaptionLines: context.bannerCaptionLines,
    expanded: context.expansion.expanded,
    shadeActive: context.expansion.shadeActive,
    anchor: context.anchor,
    terminalRef: context.terminalRef,
    markRef: context.markRef,
    startIntro: (options?: { explicit?: boolean }) => startIntro(context, options),
    skipIntro: () => skipIntro(context),
    toggleExpanded: () => toggleExpanded(context),
  };
}
