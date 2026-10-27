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
const narrowWidth = bannerWidth(xca);

export const BANNERS = {
  wide: wordmark("WELCOME TO XCA"),
  compact: `${center(welcome, stackedWidth)}\n\n${center(toXca, stackedWidth)}`,
  narrow: `${center("WELCOME TO", narrowWidth)}\n\n${xca}`,
  plain: "Welcome to XCA",
} as const;

export function selectBanner(columns: number): string {
  return (
    [BANNERS.wide, BANNERS.compact, BANNERS.narrow, BANNERS.plain].find(
      (banner) => bannerWidth(banner) <= columns,
    ) ?? BANNERS.plain
  );
}
