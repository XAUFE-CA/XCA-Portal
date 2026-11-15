/**
 * Bold ANSI Shadow-style wordmark: Unicode block/box glyphs, six rows, fixed cell width.
 * 粗体 ANSI Shadow 风格字标：使用 Unicode 方块与制表符字形，每字六行、单元格宽度固定。
 */
type Glyph = readonly [string, string, string, string, string, string];
const GLYPHS: Record<string, Glyph> = {
  W: ["██╗    ██╗", "██║    ██║", "██║ █╗ ██║", "██║███╗██║", "╚███╔███╔╝", " ╚══╝╚══╝ "],
  E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
  L: ["██╗     ", "██║     ", "██║     ", "██║     ", "███████╗", "╚══════╝"],
  C: [" ██████╗", "██╔════╝", "██║     ", "██║     ", "╚██████╗", " ╚═════╝"],
  O: [" ██████╗ ", "██╔═══██╗", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
  M: ["███╗   ███╗", "████╗ ████║", "██╔████╔██║", "██║╚██╔╝██║", "██║ ╚═╝ ██║", "╚═╝     ╚═╝"],
  T: ["████████╗", "╚══██╔══╝", "   ██║   ", "   ██║   ", "   ██║   ", "   ╚═╝   "],
  X: ["██╗  ██╗", "╚██╗██╔╝", " ╚███╔╝ ", " ██╔██╗ ", "██╔╝ ██╗", "╚═╝  ╚═╝"],
  A: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
  " ": ["   ", "   ", "   ", "   ", "   ", "   "],
};

function wordmark(text: string): string {
  const letters = [...text.toUpperCase()].map((letter) => {
    const glyph = GLYPHS[letter];
    if (!glyph) throw new Error(`Unsupported banner character: ${letter}`);
    return glyph;
  });
  return ([0, 1, 2, 3, 4, 5] as const)
    .map((row) =>
      letters
        .map((glyph) => glyph[row])
        .join(" ")
        .trimEnd(),
    )
    .join("\n");
}

export const bannerWidth = (banner: string): number =>
  Math.max(...banner.split("\n").map((row) => row.length));

function center(text: string, columns: number): string {
  const padding = " ".repeat(Math.floor((columns - bannerWidth(text)) / 2));
  return text
    .split("\n")
    .map((line) => padding + line)
    .join("\n");
}

const welcome = wordmark("WELCOME");
const toXca = wordmark("TO XCA");
const xca = wordmark("XCA");
const stackedWidth = Math.max(bannerWidth(welcome), bannerWidth(toXca));

// The narrow lead keeps ANSI lettering instead of a plain caption; the renderer scales it below
// the mark rather than widening the art.
// 窄屏标题沿用 ANSI 字形而不是普通文字；渲染时把它缩到小于字标的字号，而不加宽字符画。
export const NARROW_LEAD = wordmark("WELCOME TO");

export const BANNERS = {
  wide: wordmark("WELCOME TO XCA"),
  compact: `${center(welcome, stackedWidth)}\n\n${center(toXca, stackedWidth)}`,
  narrow: xca,
  plain: "Welcome to XCA",
} as const;

export function selectBanner(columns: number): string {
  return (
    [BANNERS.wide, BANNERS.compact, BANNERS.narrow, BANNERS.plain].find(
      (banner) => bannerWidth(banner) <= columns,
    ) ?? BANNERS.plain
  );
}

/** Row stages include the narrow lead as one printed row above the six-row mark.
 *  行阶段把窄屏标题算作字标六行之上的一行。 */
export function bannerRowCount(columns: number): number {
  const banner = selectBanner(columns);
  return banner.split("\n").length + (banner === BANNERS.narrow ? 1 : 0);
}
