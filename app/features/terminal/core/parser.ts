import { defaultTranslator, type Translator } from "../../../i18n";
/**
 * Strict browser command parser. There is intentionally no shell evaluation.
 * 严格的浏览器命令解析器。此处刻意不做任何 shell 求值。
 */
export function parseCommandLine(source: string, t: Translator = defaultTranslator): string[] {
  const words: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let started = false;
  let escaped = false;
  for (const char of source.trim()) {
    if (escaped) {
      token += char;
      escaped = false;
      started = true;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else token += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if ("|&;<>\n\r".includes(char)) throw new Error(t("error.shellOperators"));
    if (/\s/.test(char)) {
      if (started) {
        words.push(token);
        token = "";
        started = false;
      }
    } else {
      token += char;
      started = true;
    }
  }
  if (escaped || quote) throw new Error(t("error.unfinishedQuote"));
  if (started) words.push(token);
  return words;
}
