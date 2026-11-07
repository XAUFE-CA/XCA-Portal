/**
 * Hero titles mark accent text with `**...**`; punctuation only affects typing rhythm.
 * 首页标题用 `**...**` 标注强调文字；标点只影响打字节奏。
 */

export interface HeroTitleLetter {
  letter: string;
  index: number;
  accent: boolean;
}

export interface HeroTitle {
  text: string;
  letters: HeroTitleLetter[];
}

const ACCENT_MARK = "**";
const ACCENT_SPAN = /\*\*(.*?)\*\*/gsu;

/**
 * Parse a marked sentence into plain text and letters with continuous indices.
 * 解析带标注的语句，得到纯文本与序号连续的字符序列。
 */
export function parseHeroTitle(source: string): HeroTitle {
  const letters: HeroTitleLetter[] = [];
  const append = (text: string, accent: boolean) => {
    for (const letter of text) {
      letters.push({ letter, index: letters.length, accent });
    }
  };
  let cursor = 0;
  for (const match of source.matchAll(ACCENT_SPAN)) {
    const start = match.index ?? 0;
    // Unpaired markers never reach the screen.
    // 未成对的标注不会显示在页面上。
    append(source.slice(cursor, start).replaceAll(ACCENT_MARK, ""), false);
    append(match[1] ?? "", true);
    cursor = start + match[0].length;
  }
  append(source.slice(cursor).replaceAll(ACCENT_MARK, ""), false);
  return { text: letters.map(({ letter }) => letter).join(""), letters };
}
