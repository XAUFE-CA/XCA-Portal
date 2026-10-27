import { defaultTranslator, type MessageKey, type Translator } from "../../../i18n";
export interface TerminalBackground {
  id: string;
  label: string;
  labelKey?: MessageKey;
  color: string;
  image?: string;
}

export interface TerminalAppearance {
  background: string;
}

/**
 * Explicit background choices customize the shared token; the default inherits Neoverse-UI.
 * 显式背景选项会定制共享令牌；默认背景继承 Neoverse-UI。
 */
export class AppearanceRegistry {
  readonly backgrounds = new Map<string, TerminalBackground>();

  constructor(private t: Translator = defaultTranslator) {
    this.registerBackground({
      id: "default",
      label: "",
      labelKey: "background.default",
      color: "",
    });
    this.registerBackground({
      id: "canvas",
      label: "",
      labelKey: "background.canvas",
      color: "var(--neoverse-color-surface-canvas)",
    });
    this.registerBackground({
      id: "aurora",
      label: "",
      labelKey: "background.aurora",
      color: "var(--neoverse-color-ambient-mint)",
    });
  }

  registerBackground(background: TerminalBackground): void {
    if (
      background.image &&
      !/^(https?:\/\/|\/(?!\/)|data:image\/(png|jpeg|webp);base64,)/i.test(background.image)
    )
      throw new Error(this.t("error.backgroundImage"));
    this.backgrounds.set(background.id, { ...background });
  }

  resolve(value: TerminalAppearance): Record<string, string> {
    const background = this.backgrounds.get(value.background);
    if (!background) throw new Error(this.t("error.appearance"));
    return {
      ...(background.color ? { "--neoverse-terminal-background": background.color } : {}),
      ...(background.image
        ? { "--xca-terminal-background-image": `url(${JSON.stringify(background.image)})` }
        : {}),
    };
  }
}
