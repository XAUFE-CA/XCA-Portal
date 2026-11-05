import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface TextPair {
  stem: string;
  zh: string;
  en: string;
}

export interface TranslationBaseline {
  version: 1;
  files: Record<string, Record<string, string[]>>;
}

export const BASELINE_VERSION = 1;
export const BASELINE_PATH = join(import.meta.dir, "translation-baseline.json");
const FILES_DIRECTORY = join(import.meta.dir, "files");
const HEADINGS = [/^#{1,6}\s/, /^\d+\.\s/, /^[一二三四五六七八九十]+、/];

export type LineKind = "blank" | "directive" | "heading" | "body";

export function lineKind(value: string): LineKind {
  if (!value.trim()) return "blank";
  if (/^(?:export\s+)?[A-Z][A-Z0-9_]*=/.test(value)) return "directive";
  return HEADINGS.some((pattern) => pattern.test(value)) ? "heading" : "body";
}

/**
 * Short content hash. It records the source at translation time; it never proves the target is correct.
 * 短内容哈希。它记录翻译时的原文，不能证明译文语义正确。
 */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function placeholders(value: string): string {
  return [...value.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1] ?? "")
    .sort()
    .join(",");
}

function preview(value: string): string {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/**
 * Reads every on-disk bilingual pair. A missing counterpart fails with the expected file name.
 * 读取磁盘上的全部双语对。缺少对应文件时直接指出期望的文件名。
 */
export function readPairs(): TextPair[] {
  const names = readdirSync(FILES_DIRECTORY);
  return names
    .filter((name) => name.endsWith(".zh-CN.txt"))
    .map((name) => {
      const stem = name.slice(0, -".zh-CN.txt".length);
      const enPath = join(FILES_DIRECTORY, `${stem}.en.txt`);
      if (!existsSync(enPath)) throw new Error(`${stem}: 缺少 ${stem}.en.txt`);
      return {
        stem,
        zh: readFileSync(join(FILES_DIRECTORY, name), "utf8").replace(/\r\n/g, "\n"),
        en: readFileSync(enPath, "utf8").replace(/\r\n/g, "\n"),
      };
    })
    .sort((left, right) => left.stem.localeCompare(right.stem));
}

export function readBaseline(): TranslationBaseline {
  if (!existsSync(BASELINE_PATH)) return { version: BASELINE_VERSION, files: {} };
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as TranslationBaseline;
}

/**
 * Structural parity: same lines, same line kinds, same placeholders, identical directive lines.
 * 结构一致：行数、行类型、占位符相同，指令行逐字相同。
 */
export function structuralIssues(pair: TextPair): string[] {
  const zh = pair.zh.split("\n");
  const en = pair.en.split("\n");
  if (zh.length !== en.length) return [`行数不一致：中文 ${zh.length} 行，英文 ${en.length} 行`];
  const issues: string[] = [];
  for (const [index, zhLine] of zh.entries()) {
    const enLine = en[index] ?? "";
    const position = `第 ${index + 1} 行`;
    if (lineKind(enLine) !== lineKind(zhLine)) issues.push(`${position}：行类型不一致`);
    if (placeholders(enLine) !== placeholders(zhLine)) issues.push(`${position}：占位符不一致`);
    if (lineKind(zhLine) === "directive" && enLine !== zhLine)
      issues.push(`${position}：指令行必须逐字一致`);
  }
  return issues;
}

/**
 * Baseline comparison: every source line must keep the target recorded at stamp time.
 * 基线比对：每条原文行必须与登记时记录的译文一致。
 */
export function baselineIssues(
  pair: TextPair,
  memory: Record<string, string[]> | undefined,
): string[] {
  if (!memory) return ["未登记译文基线：翻译完成后运行 bun run texts:stamp"];
  const zh = pair.zh.split("\n");
  const en = pair.en.split("\n");
  if (zh.length !== en.length) return ["行数不一致：先对齐结构，再登记译文"];
  const issues: string[] = [];
  const current = new Set<string>();
  for (const [index, zhLine] of zh.entries()) {
    if (lineKind(zhLine) === "blank") continue;
    const source = fingerprint(zhLine);
    current.add(source);
    const targets = memory[source];
    if (!targets) {
      issues.push(`第 ${index + 1} 行：中文已修改或新增，未登记对应英文（${preview(zhLine)}）`);
      continue;
    }
    const target = en[index] ?? "";
    if (!targets.includes(fingerprint(target)))
      issues.push(`第 ${index + 1} 行：英文与已登记译文不一致（${preview(target)}）`);
  }
  const stale = Object.keys(memory).filter((source) => !current.has(source)).length;
  if (stale) issues.push(`基线含 ${stale} 条已删除或改写的原文行：运行 bun run texts:stamp 清理`);
  return issues;
}

/**
 * Writes the reviewed baseline in the repository formatter's shape: one entry per line while it fits.
 * 按仓库格式化规则输出已审基线：单条能放下时保持单行。
 */
export function serializeBaseline(baseline: TranslationBaseline): string {
  const quote = (value: string) => JSON.stringify(value);
  const files = Object.entries(baseline.files).map(([stem, memory]) => {
    const entries = Object.entries(memory).map(([source, targets]) => {
      const inline = `      ${quote(source)}: [${targets.map(quote).join(", ")}]`;
      if (inline.length + 1 <= 100) return inline;
      return [
        `      ${quote(source)}: [`,
        ...targets.map(
          (target, index) => `        ${quote(target)}${index === targets.length - 1 ? "" : ","}`,
        ),
        "      ]",
      ].join("\n");
    });
    return `    ${quote(stem)}: {\n${entries.join(",\n")}\n    }`;
  });
  const body = files.length ? `\n${files.join(",\n")}\n  ` : "";
  return `{\n  "version": ${baseline.version},\n  "files": {${body}}\n}\n`;
}

/**
 * Records the current pairs as the reviewed state. Structure must already match.
 * 将当前成对正文登记为已审状态。调用前结构必须已经一致。
 */
export function buildBaseline(pairs: TextPair[]): TranslationBaseline {
  const files: Record<string, Record<string, string[]>> = {};
  for (const pair of pairs) {
    const zh = pair.zh.split("\n");
    const en = pair.en.split("\n");
    if (zh.length !== en.length) throw new Error(`${pair.stem}: 行数不一致`);
    const memory: Record<string, string[]> = {};
    for (const [index, zhLine] of zh.entries()) {
      if (lineKind(zhLine) === "blank") continue;
      const source = fingerprint(zhLine);
      const target = fingerprint(en[index] ?? "");
      const targets = memory[source];
      if (!targets) memory[source] = [target];
      else if (!targets.includes(target)) targets.push(target);
    }
    files[pair.stem] = Object.fromEntries(
      Object.entries(memory)
        .map(([source, targets]) => [source, [...targets].sort()] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    );
  }
  return {
    version: BASELINE_VERSION,
    files: Object.fromEntries(
      Object.entries(files).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}
