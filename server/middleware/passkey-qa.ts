export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname;
  if (path !== "/auth/passkey" && !path.startsWith("/auth/passkey/")) return;
  // The page and its availability probe are unreachable unless the server-only test flag is true.
  // 仅当服务端测试开关为 true 时，页面及其可用性探测才可访问。
  if (String(useRuntimeConfig(event).passkeyQa) !== "true")
    throw createError({ statusCode: 404, statusMessage: "Not Found" });
});
