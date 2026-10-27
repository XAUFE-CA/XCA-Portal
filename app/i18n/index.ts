import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

export const locales = ["zh-CN", "en"] as const;
export type SiteLocale = (typeof locales)[number];
export type MessageKey = keyof typeof zh;
export type MessageParams = Record<string, string | number>;
export type Translator = (key: MessageKey, params?: MessageParams) => string;
const messages: Record<SiteLocale, Record<MessageKey, string>> = { "zh-CN": zh, en };

export function isSiteLocale(value: unknown): value is SiteLocale {
  return locales.some((locale) => locale === value);
}

export function createTranslator(getLocale: () => SiteLocale): Translator {
  return (key, params = {}) =>
    messages[getLocale()][key].replace(/\{(\w+)\}/g, (match, name: string) =>
      params[name] === undefined ? match : String(params[name]),
    );
}

export const defaultTranslator = createTranslator(() => "zh-CN");
