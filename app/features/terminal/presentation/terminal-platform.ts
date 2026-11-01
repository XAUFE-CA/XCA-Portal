export type TerminalPlatform = "macos" | "windows" | "other";

interface PlatformInfo {
  userAgentData?: { platform?: string };
  platform?: string;
  userAgent?: string;
}

const APPLE_PLATFORM =
  /^(?:Mac|iPhone|iPad|iPod|iOS|tvOS|watchOS|visionOS|AppleTV|AppleWatch|AppleVision)/i;
const APPLE_USER_AGENT =
  /Macintosh|Mac OS X|iPhone|iPad|iPod|\b(?:iOS|tvOS|watchOS|visionOS)\b|AppleTV|AppleWatch|AppleVision/i;

export function detectTerminalPlatform(info: PlatformInfo): TerminalPlatform {
  const platform = info.userAgentData?.platform || info.platform || "";
  const userAgent = info.userAgent || "";
  if (APPLE_PLATFORM.test(platform)) return "macos";
  if (/^Win/i.test(platform)) return "windows";
  if (platform) return "other";
  if (/Android/i.test(userAgent)) return "other";
  if (APPLE_USER_AGENT.test(userAgent)) return "macos";
  if (/Windows/i.test(userAgent)) return "windows";
  return "other";
}
