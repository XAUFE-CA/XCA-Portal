import type { Translator } from "~/i18n";
import { copyFeedbackKey } from "../core/menu-model";
import { copyText } from "./clipboard";

/**
 * Copy a value and return the status line for the region to announce. An empty value
 * reports as such instead of as a permission failure.
 * 复制内容并返回区域需要提示的状态行。内容为空时按空内容报告，而不是报告权限失败。
 */
export async function copyResult(text: string, t: Translator): Promise<string> {
  const copied = await copyText(text);
  return t(copyFeedbackKey(text, copied));
}

/**
 * Copy a link target, resolving relative URLs against the current document so the
 * clipboard always holds an address that can be pasted elsewhere.
 * 复制链接目标，并把相对地址解析为当前文档的绝对地址，剪贴板因此始终保存可粘贴到别处的地址。
 */
export async function copyLinkResult(href: string, t: Translator): Promise<string> {
  const absolute =
    typeof window === "undefined" ? href : new URL(href, window.location.href).toString();
  return copyResult(absolute, t);
}
