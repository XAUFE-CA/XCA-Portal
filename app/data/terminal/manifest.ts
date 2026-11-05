import { TERMINAL } from "../../features/terminal/config";
import { createTranslator, type SiteLocale, type Translator } from "../../i18n";
import eventsEn from "./files/events.en.txt?raw";
import eventsZh from "./files/events.zh-CN.txt?raw";
import handbookEn from "./files/handbook.en.txt?raw";
import handbookZh from "./files/handbook.zh-CN.txt?raw";
import motdEn from "./files/motd.en.txt?raw";
import motdZh from "./files/motd.zh-CN.txt?raw";
import osRelease from "./files/os-release.txt?raw";
import profileEn from "./files/profile.en.txt?raw";
import profileZh from "./files/profile.zh-CN.txt?raw";
import readmeEn from "./files/readme.en.txt?raw";
import readmeZh from "./files/readme.zh-CN.txt?raw";

export type VirtualFileContent = string | Record<SiteLocale, string>;
export interface VirtualFileDefinition {
  path: string;
  kind: "file";
  content: VirtualFileContent;
}
/**
 * Virtual workspace layout. Paths and bodies live here, so content changes never touch Core or commands.
 * 虚拟工作区结构。路径与正文集中于此，修改内容无需改动 Core 或命令。
 */
export const virtualDirectories: string[] = [
  "/",
  "/home",
  TERMINAL.identity.home,
  "/community",
  "/etc",
];
export const virtualFiles: VirtualFileDefinition[] = [
  {
    path: `${TERMINAL.identity.home}/README.md`,
    kind: "file",
    content: { "zh-CN": readmeZh, en: readmeEn },
  },
  {
    path: `${TERMINAL.identity.home}/.profile`,
    kind: "file",
    content: { "zh-CN": profileZh, en: profileEn },
  },
  { path: "/etc/os-release", kind: "file", content: osRelease },
  { path: "/etc/motd", kind: "file", content: { "zh-CN": motdZh, en: motdEn } },
  {
    path: "/community/handbook.txt",
    kind: "file",
    content: { "zh-CN": handbookZh, en: handbookEn },
  },
  { path: "/community/events.txt", kind: "file", content: { "zh-CN": eventsZh, en: eventsEn } },
];
const placeholders: Record<string, (t: Translator) => string> = {
  name: () => TERMINAL.brand.name,
  tagline: (t) => t("terminal.welcomeTagline"),
  hint: (t) => t("terminal.welcomeHint"),
};
/**
 * Resolves one body with the current locale, matching the i18n interpolation syntax.
 * 按当前语言解析正文，沿用 i18n 的插值语法。
 */
export function readVirtualFile(file: VirtualFileDefinition, getLocale: () => SiteLocale): string {
  const t = createTranslator(getLocale);
  const source = typeof file.content === "string" ? file.content : file.content[getLocale()];
  return source.replace(/\{(\w+)\}/g, (match, name: string) => placeholders[name]?.(t) ?? match);
}
