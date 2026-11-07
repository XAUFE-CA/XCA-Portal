import { describe, expect, test } from "bun:test";
import heroSentences from "../../data/hero-sentences.json";
import { parseHeroTitle } from "./hero-title";

function accentText(source: string): string {
  return parseHeroTitle(source)
    .letters.filter(({ accent }) => accent)
    .map(({ letter }) => letter)
    .join("");
}

describe("hero title accents", () => {
  test("an unmarked sentence keeps its text and has no accent", () => {
    const parsed = parseHeroTitle("欢迎来到 XCA 计算机学社。");
    expect(parsed.text).toBe("欢迎来到 XCA 计算机学社。");
    expect(parsed.letters.every(({ accent }) => !accent)).toBe(true);
    expect(parsed.letters.map(({ index }) => index)).toEqual(parsed.letters.map((_, i) => i));
  });

  test("a marked span accents only its own characters", () => {
    const parsed = parseHeroTitle("为好奇心，**打开下一行**。");
    expect(parsed.text).toBe("为好奇心，打开下一行。");
    expect(accentText("为好奇心，**打开下一行**。")).toBe("打开下一行");
    expect(parsed.letters.filter(({ accent }) => accent).map(({ index }) => index)).toEqual([
      5, 6, 7, 8, 9,
    ]);
    expect(parsed.letters.every(({ index }, i) => index === i)).toBe(true);
  });

  test("multiple marked spans keep continuous indices", () => {
    const parsed = parseHeroTitle("**从**，**走向**发现");
    expect(parsed.text).toBe("从，走向发现");
    expect(accentText("**从**，**走向**发现")).toBe("从走向");
    expect(parsed.letters.map(({ index }) => index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("unpaired and empty markers produce no stray characters", () => {
    expect(parseHeroTitle("A**B").text).toBe("AB");
    expect(parseHeroTitle("A****B").text).toBe("AB");
    expect(parseHeroTitle("A****B").letters.every(({ accent }) => !accent)).toBe(true);
  });

  test("localized sentences mark accents independently of punctuation", () => {
    const zh = heroSentences["zh-CN"];
    const en = heroSentences.en;
    expect(zh.length).toBe(en.length);
    for (const [locale, sentences] of Object.entries(heroSentences)) {
      for (const source of sentences) {
        const parsed = parseHeroTitle(source);
        expect(parsed.text, locale).not.toContain("**");
        expect(parsed.text.length, locale).toBeGreaterThan(0);
        expect((source.match(/\*\*/g) ?? []).length % 2, locale).toBe(0);
        expect(accentText(source).length, locale).toBeGreaterThan(0);
      }
    }
    const beforeComma = "**从问题**，走向新发现。";
    expect(zh).toContain(beforeComma);
    expect(accentText(beforeComma)).toBe("从问题");
    expect(beforeComma.indexOf("**")).toBeLessThan(beforeComma.indexOf("，"));
  });
});
