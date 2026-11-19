import { isIP } from "node:net";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const unavailable = () => {
    setResponseStatus(event, 503);
    return { error: { code: "service_unavailable" } };
  };

  let target: URL;
  try {
    const upstream = new URL(useRuntimeConfig(event).backendApi);
    if (
      !["http:", "https:"].includes(upstream.protocol) ||
      upstream.username ||
      upstream.password ||
      upstream.pathname !== "/" ||
      upstream.search ||
      upstream.hash ||
      !event.path.startsWith("/api/v1/")
    )
      return unavailable();
    target = new URL(event.path, upstream);
    if (target.origin !== upstream.origin || !target.pathname.startsWith("/api/v1/"))
      return unavailable();
  } catch {
    return unavailable();
  }

  // Forward only the headers the portal API needs, never client-supplied proxy headers.
  // 只转发门户接口所需的请求头，绝不转发客户端提供的代理请求头。
  const headers: Record<string, string> = {};
  for (const name of [
    "accept",
    "content-type",
    "content-length",
    "cookie",
    "origin",
    "x-xca-auth-operation",
  ]) {
    const value = getRequestHeader(event, name);
    if (value) headers[name] = value;
  }
  const peer = event.node.req.socket.remoteAddress;
  if (peer && isIP(peer)) headers["x-forwarded-for"] = peer;

  try {
    const carriesBody = ["POST", "PUT", "PATCH", "DELETE"].includes(event.method);
    return await sendProxy(event, target.href, {
      fetchOptions: {
        method: event.method,
        headers,
        body: carriesBody ? getRequestWebStream(event) : undefined,
        duplex: carriesBody ? "half" : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      },
      onResponse: () => setResponseHeader(event, "Cache-Control", "no-store"),
    });
  } catch {
    if (event.node.res.headersSent) throw createError({ statusCode: 503 });
    return unavailable();
  }
});
