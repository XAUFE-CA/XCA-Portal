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

/**
 * Read one message in a fixed locale, independent of the visitor's current choice.
 * 按指定语言读取一条消息，不受访客当前所选语言影响。
 */
export function translate(locale: SiteLocale, key: MessageKey, params: MessageParams = {}): string {
  return messages[locale][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}

export function createTranslator(getLocale: () => SiteLocale): Translator {
  return (key, params = {}) => translate(getLocale(), key, params);
}

export const defaultTranslator = createTranslator(() => "zh-CN");
