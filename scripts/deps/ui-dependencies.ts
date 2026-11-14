type Manifest = {
  dependencies?: Record<string, string>;
  overrides?: Record<string, string>;
};

export type UiDependencyState = "local" | "published" | "mixed";

// All Neoverse-UI entries must share one source; mixed local and published packages hide version mismatch.
// 所有 Neoverse-UI 条目必须来源一致。本地与发布包混用会掩盖版本不一致。
export function uiDependencyState(manifest: Manifest): UiDependencyState {
  const specs = [
    ...Object.entries(manifest.dependencies ?? {}),
    ...Object.entries(manifest.overrides ?? {}),
  ]
    .filter(([name]) => name.startsWith("@neoverse-ui/"))
    .map(([, specifier]) => specifier)
    .filter((specifier): specifier is string => typeof specifier === "string");
  const local = specs.filter((specifier) => specifier.startsWith("file:")).length;
  if (local === 0) return "published";
  return local === specs.length ? "local" : "mixed";
}
