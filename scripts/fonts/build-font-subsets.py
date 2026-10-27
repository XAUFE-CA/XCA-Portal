"""Generate the portal's self-hosted terminal font subsets.

The upstream Maple Mono NF CN faces ship ~33k glyphs (19.8 MB as WOFF). The
portal renders a bounded character set, so this tool writes two WOFF2 subsets
that keep monospace metrics for every character the site can display, plus
GB2312 level-1 (the 3755 most common hanzi) so visitors can type Chinese.

Usage (needs Python 3.10+, `pip install fonttools brotli`):

    python scripts/fonts/build-font-subsets.py --source fonts-source

`fonts-source/` is gitignored and must contain the original upstream files
(`maple-mono-nf-cn-regular.woff`, `maple-mono-nf-cn-italic.woff`). Download them
from https://github.com/subframe7536/maple-font/releases (OFL 1.1).

Subsets are modified fonts under OFL 1.1 and use the internal family name
"XCA Code Subset". CSS keeps the existing public alias and shared code roles;
font outlines, monospace metrics and italic glyphs come from the upstream faces.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TARGET_DIR = os.path.join(ROOT, "app", "assets", "fonts")
MANIFEST = os.path.join(ROOT, "scripts", "fonts", "glyph-coverage.json")

SOURCES = {
    "regular": "maple-mono-nf-cn-regular.woff",
    "italic": "maple-mono-nf-cn-italic.woff",
}
OUTPUTS = {
    "regular": "maple-mono-nf-cn-regular.woff2",
    "italic": "maple-mono-nf-cn-italic.woff2",
}
SUBFAMILY = {"regular": "Regular", "italic": "Italic"}
# Consumed by app/, content/, tests/ and public/ at build time.
# 构建时由 app/、content/、tests/ 与 public/ 使用。
SCAN = [
    ("app", {".vue", ".ts", ".json", ".css"}),
    ("content", {".md", ".yml"}),
    ("tests", {".ts"}),
    ("public", {".js"}),
]


def scanned_codepoints() -> set[int]:
    codepoints: set[int] = set()
    for folder, extensions in SCAN:
        for current, _dirs, files in os.walk(os.path.join(ROOT, folder)):
            for name in files:
                if os.path.splitext(name)[1] in extensions:
                    with open(os.path.join(current, name), encoding="utf-8") as handle:
                        codepoints.update(ord(char) for char in handle.read())
    return codepoints


def gb2312_level1() -> set[int]:
    """GB2312 rows 16-55 plus its symbol rows: 3755 common hanzi + punctuation."""
    codepoints: set[int] = set()
    ranges = [(0xA1, 0xAA)] + [(high, high + 1) for high in range(0xB0, 0xD8)]
    for start, end in ranges:
        for high in range(start, end):
            for low in range(0xA1, 0xFF):
                try:
                    codepoints.add(ord(bytes([high, low]).decode("gb2312")))
                except UnicodeDecodeError:
                    continue
    return codepoints


def terminal_symbols() -> set[int]:
    """Block ranges the terminal chrome, banner, menus and status bar can render."""
    ranges = [
        (0x00A0, 0x0100),  # Latin-1 supplement: · © etc.
        (0x2000, 0x2070),  # general punctuation: … — ‘ ’ “ ”
        (0x20A0, 0x20D0),  # currency signs
        (0x2190, 0x2200),  # arrows: → ↗ ← ↙
        (0x2200, 0x2300),  # mathematical operators
        (0x2500, 0x2600),  # box drawing, block elements, geometric shapes
        (0x2600, 0x2800),  # misc symbols + dingbats: ❯ ✓ ✗
        (0x3000, 0x3040),  # CJK symbols and punctuation
        (0xFF00, 0xFF60),  # fullwidth forms
    ]
    codepoints: set[int] = set(range(0x20, 0x7F))
    for start, end in ranges:
        codepoints.update(range(start, end))
    return codepoints


def rename(font: TTFont, style: str, family: str) -> None:
    """Keep upstream names when the family is unchanged; otherwise emit new ones."""
    if family == font["name"].getDebugName(1):
        return
    postscript = family.replace(" ", "-")
    values = {
        1: family,
        2: SUBFAMILY[style],
        3: f"{family};{SUBFAMILY[style]}",
        4: f"{family} {SUBFAMILY[style]}",
        6: f"{postscript}-{SUBFAMILY[style]}",
        16: family,
        17: SUBFAMILY[style],
    }
    table = font["name"]
    for name_id, value in values.items():
        # Windows Unicode BMP + Macintosh Roman, matching the upstream records.
        # Windows Unicode BMP 与 Macintosh Roman 编码，与上游记录一致。
        table.setName(value, name_id, 3, 1, 0x409)
        table.setName(value, name_id, 1, 0, 0)


def build(style: str, source: str, codepoints: set[int], family: str) -> dict:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.name_languages = ["*"]
    options.glyph_names = True
    options.notdef_glyph = True
    options.notdef_outline = True
    options.recommended_glyphs = True
    options.hinting = True
    options.drop_tables += ["meta"]

    font = subset.load_font(source, options)
    available = set(font.getBestCmap())
    missing = sorted(code for code in codepoints if code not in available)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=sorted(codepoints & available))
    subsetter.subset(font)
    rename(font, style, family)

    target = os.path.join(TARGET_DIR, OUTPUTS[style])
    subset.save_font(font, target, options)
    glyphs = len(font.getGlyphOrder())
    font.close()

    return {
        "file": OUTPUTS[style],
        "bytes": os.path.getsize(target),
        "codepoints": len(codepoints & available),
        "glyphs": glyphs,
        "missingFromSource": missing,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        default=os.path.join(ROOT, "fonts-source"),
        help="directory containing the original Maple Mono NF CN WOFF files",
    )
    parser.add_argument("--family", default="XCA Code Subset", help="non-reserved internal family name to emit")
    args = parser.parse_args()
    if not args.family.strip() or {"maple", "mono"} & set(args.family.lower().split()):
        parser.error("choose a non-reserved internal family name without Maple or Mono")

    scanned = scanned_codepoints()
    wanted = scanned | gb2312_level1() | terminal_symbols()
    os.makedirs(TARGET_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)

    report = {
        "family": args.family,
        "upstream": "Maple Mono NF CN 7.900 (SIL OFL 1.1, Reserved Font Name: Maple Mono)",
        "scannedCharacters": "".join(sorted(chr(code) for code in scanned)),
        "scannedCodepoints": len(scanned),
        "gb2312Level1Codepoints": len(gb2312_level1()),
        "terminalSymbolCodepoints": len(terminal_symbols()),
        "requestedCodepoints": len(wanted),
        "styles": {},
    }
    for style, filename in SOURCES.items():
        source = os.path.join(args.source, filename)
        if not os.path.exists(source):
            raise SystemExit(f"missing source font: {source}")
        result = build(style, source, wanted, args.family)
        missing = result.pop("missingFromSource")
        report["styles"][style] = {**result, "missingFromSource": len(missing)}
        print(
            f"{OUTPUTS[style]:34} {result['bytes'] / 1024:8.1f} KB  "
            f"{result['codepoints']} codepoints / {result['glyphs']} glyphs"
        )
        if missing:
            print(f"  not in upstream face: {len(missing)} codepoints (fallback applies)")

    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"coverage manifest: {MANIFEST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
