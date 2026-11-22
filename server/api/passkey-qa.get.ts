export default defineEventHandler((event) => {
  if (String(useRuntimeConfig(event).passkeyQa) !== "true")
    throw createError({ statusCode: 404, statusMessage: "Not Found" });
  return { enabled: true };
});
