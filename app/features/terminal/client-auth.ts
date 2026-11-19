import { type AuthClient, getAuthClient } from "../auth/client";
import { TERMINAL } from "./config";
import type { AuthGateway } from "./core/types";

export function createTerminalAuth(client: AuthClient = getAuthClient()): AuthGateway {
  return {
    getSession: (signal) => client.getSession(signal),
    logout: (signal) => client.logout(signal),
    async login(ctx, signal) {
      const method = await ctx.choose(ctx.t("auth.method"), [
        { id: "existing", label: ctx.t("auth.existing") },
        { id: "invitation", label: ctx.t("auth.invitation") },
      ]);
      signal.throwIfAborted();
      const email = await ctx.ask({ label: ctx.t("auth.email"), kind: "text" });
      signal.throwIfAborted();
      const invitation =
        method === "invitation"
          ? await ctx.ask({ label: ctx.t("auth.invitationCode"), kind: "secret" })
          : undefined;
      signal.throwIfAborted();
      const requested = await client.requestCode(
        { email, ...(invitation === undefined ? {} : { invitation }) },
        signal,
      );
      if (!requested.ok) return requested;
      signal.throwIfAborted();
      ctx.write({ type: "line", text: ctx.t("auth.codeSent"), tone: "muted" });
      const code = await ctx.ask({
        label: ctx.t("auth.code"),
        kind: "otp",
        timeoutMs: TERMINAL.limits.otpInputTimeout,
      });
      signal.throwIfAborted();
      return client.verifyCode({ flow_id: requested.value.flow_id, code }, signal);
    },
  };
}
