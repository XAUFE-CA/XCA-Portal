import { describe, expect, test } from "bun:test";
import { detectTerminalPlatform } from "./terminal-platform";

describe("terminal platform", () => {
  test("prefers the explicit browser platform over legacy desktop hints", () => {
    expect(
      detectTerminalPlatform({
        userAgentData: { platform: "macOS" },
        platform: "Win32",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      }),
    ).toBe("macos");
    expect(
      detectTerminalPlatform({
        userAgentData: { platform: "Windows" },
        platform: "MacIntel",
      }),
    ).toBe("windows");
  });

  test("falls back to legacy platform and then user agent when hints are unavailable", () => {
    expect(detectTerminalPlatform({ platform: "MacIntel" })).toBe("macos");
    expect(detectTerminalPlatform({ platform: "Win32" })).toBe("windows");
    expect(
      detectTerminalPlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }),
    ).toBe("macos");
    expect(detectTerminalPlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0)" })).toBe("windows");
  });

  test("uses Mac window chrome for desktop-mode iPadOS", () => {
    const desktopHints = {
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      maxTouchPoints: 5,
    };
    expect(detectTerminalPlatform(desktopHints)).toBe("macos");
  });

  test("shares Mac window chrome with iPhone from platform hints or user agent", () => {
    expect(
      detectTerminalPlatform({
        userAgentData: { platform: "iOS" },
        platform: "iPhone",
      }),
    ).toBe("macos");
    expect(
      detectTerminalPlatform({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      }),
    ).toBe("macos");
  });

  test("shares Mac window chrome across Apple tablet, media and spatial platforms", () => {
    expect(detectTerminalPlatform({ platform: "iPad" })).toBe("macos");
    expect(detectTerminalPlatform({ userAgentData: { platform: "visionOS" } })).toBe("macos");
    expect(detectTerminalPlatform({ userAgent: "AppleTV6,2" })).toBe("macos");
    expect(detectTerminalPlatform({ userAgent: "Mozilla/5.0 (iPod touch; CPU iPhone OS)" })).toBe(
      "macos",
    );
  });

  test("keeps other mobile and unsupported desktop systems neutral", () => {
    expect(
      detectTerminalPlatform({ userAgentData: { platform: "Android" }, platform: "Linux armv8l" }),
    ).toBe("other");
    expect(
      detectTerminalPlatform({ userAgent: "Mozilla/5.0 (Linux; Android 14) like Mac OS X" }),
    ).toBe("other");
    expect(detectTerminalPlatform({ platform: "Linux x86_64" })).toBe("other");
    expect(detectTerminalPlatform({})).toBe("other");
  });
});
