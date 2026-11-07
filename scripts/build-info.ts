import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type BuildInfo = {
  sha: string;
  shortSha: string;
  committedAt: string;
  commitUrl: string;
};

export const REPOSITORY_URL = "https://github.com/XAUFE-CA/XCA-Portal";
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function commitUrl(sha: string): string {
  return `${REPOSITORY_URL}/commit/${sha}`;
}

// Parse the tab-separated Git record without executing Git, so the shape stays testable.
// 解析以制表符分隔的 Git 记录，不执行 Git，使数据结构可测试。
export function parseBuildInfo(record: string): BuildInfo | null {
  const [sha, shortSha, timestamp] = record.trim().split("\t");
  if (!sha || !SHA_PATTERN.test(sha) || !shortSha) return null;
  // Keep the committer's own timestamp; only the ISO separator becomes a space.
  // 保留提交者自身的时间戳，只把 ISO 分隔符换成空格。
  const committedAt =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.exec(timestamp ?? "")?.[0].replace("T", " ") ?? "";
  const normalized = sha.toLowerCase();
  return {
    sha: normalized,
    shortSha: shortSha.toLowerCase(),
    committedAt,
    commitUrl: commitUrl(normalized),
  };
}

// Resolve the repository root from this script so Windows and POSIX checkouts behave alike.
// 从本脚本解析仓库根目录，使 Windows 与 POSIX 检出行为一致。
export function readBuildInfo(
  cwd = fileURLToPath(new URL("..", import.meta.url)),
): BuildInfo | null {
  try {
    const record = execFileSync("git", ["log", "-1", "--format=%H%x09%h%x09%cI"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseBuildInfo(String(record));
  } catch {
    // A checkout without Git still exposes the built commit through the CI environment.
    // 没有 Git 的检出仍可通过 CI 环境变量提供构建提交。
    const sha = process.env.GITHUB_SHA;
    if (!sha || !SHA_PATTERN.test(sha)) return null;
    const normalized = sha.toLowerCase();
    return {
      sha: normalized,
      shortSha: normalized.slice(0, 7),
      committedAt: "",
      commitUrl: commitUrl(normalized),
    };
  }
}
