<script setup lang="ts">
import { UiButton, UiCard, UiField, UiInput } from "@neoverse-ui/vue";
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import {
  getPasskeyWorkflow,
  type PasskeyManagementErrorCode,
  type PasskeyOperationOutcome,
  type PasskeyPhaseListener,
  type PasskeySummary,
  type PasskeyWorkflow,
} from "~/features/auth/passkey/workflow";
import { type AuthSnapshot, getAuthClient } from "~/features/auth/session/client";
import type { MessageKey } from "~/i18n";

const availability = await useFetch("/api/passkey-qa");
if (availability.error.value) throw createError({ statusCode: 404, statusMessage: "Not Found" });

const { locale, t } = useSiteLocale();
const email = ref("");
const invitation = ref("");
const code = ref("");
const snapshot = ref<AuthSnapshot>({
  status: "unknown",
  identity: null,
  needsReconciliation: false,
});
const credentials = ref<PasskeySummary[]>([]);
const supported = ref(true);
const running = ref("");
const cancelable = ref(false);
const notice = ref<{ tone: "error" | "success" | "info"; key: MessageKey; code?: string }>();
const workflow = shallowRef<PasskeyWorkflow>();
const cancelController = shallowRef<AbortController>();
let unsubscribe = () => {};
let stop = () => {};

const errorKeys: Record<PasskeyManagementErrorCode, MessageKey> = {
  unsupported: "passkeyQa.error.unsupported",
  cancelled: "passkeyQa.error.cancelled",
  invalid: "passkeyQa.error.invalid",
  security: "passkeyQa.error.security",
  network: "passkeyQa.error.network",
  authentication_required: "passkeyQa.error.authenticationRequired",
  recent_otp_required: "passkeyQa.error.recentOtpRequired",
  invalid_request: "passkeyQa.error.invalidRequest",
  invalid_or_expired_code: "passkeyQa.error.invalidCode",
  invalid_or_expired_registration: "passkeyQa.error.invalidRegistration",
  invalid_or_expired_authentication: "passkeyQa.error.invalidAuthentication",
  credential_exists: "passkeyQa.error.credentialExists",
  credential_not_found: "passkeyQa.error.credentialNotFound",
  operation_abandoned: "passkeyQa.error.operationAbandoned",
  rate_limited: "passkeyQa.error.rateLimited",
  service_unavailable: "passkeyQa.error.unavailable",
};

function showError(code: PasskeyManagementErrorCode) {
  notice.value = { tone: "error", key: errorKeys[code], code };
}

function showNotice(key: MessageKey, tone: "success" | "info" = "success") {
  notice.value = { tone, key };
}

function outcomeNotice(outcome: PasskeyOperationOutcome | "failed") {
  if (outcome === "registration_revoked")
    showNotice("passkeyQa.outcome.registrationRevoked", "info");
  else if (outcome === "revocation_committed")
    showNotice("passkeyQa.outcome.revocationCommitted", "info");
  else if (outcome === "failed") showNotice("passkeyQa.outcome.pending", "info");
}

async function loadCredentials(explicit = false) {
  if (!workflow.value) return;
  const result = await workflow.value.list();
  if (result.ok) {
    credentials.value = result.value;
    return;
  }
  if (explicit && result.code !== "authentication_required") showError(result.code);
  if (result.code === "authentication_required") credentials.value = [];
}

async function withCeremony(
  name: string,
  task: (signal: AbortSignal, onPhase: PasskeyPhaseListener) => Promise<void>,
) {
  running.value = name;
  cancelable.value = true;
  notice.value = undefined;
  const controller = new AbortController();
  cancelController.value = controller;
  try {
    await task(controller.signal, (phase) => {
      cancelable.value = phase !== "submit";
    });
  } catch (error) {
    showError(
      error instanceof DOMException && error.name === "AbortError" ? "cancelled" : "network",
    );
  } finally {
    if (cancelController.value === controller) cancelController.value = undefined;
    running.value = "";
    cancelable.value = false;
  }
}

async function requestCodeWithFlow() {
  if (!email.value.trim()) return showError("invalid_request");
  if (running.value) return;
  running.value = "request";
  notice.value = undefined;
  try {
    const result = await getAuthClient().requestCode({
      email: email.value.trim(),
      ...(invitation.value.trim() ? { invitation: invitation.value.trim() } : {}),
    });
    if (!result.ok) return showError(result.code);
    currentFlow = result.value.flow_id;
    showNotice("passkeyQa.notice.codeSent", "info");
  } catch {
    showError("network");
  } finally {
    running.value = "";
  }
}

async function verifyCode() {
  if (!currentFlow || !code.value.trim() || running.value) {
    return showError("invalid_request");
  }
  running.value = "verify";
  notice.value = undefined;
  try {
    const result = await getAuthClient().verifyCode({
      flow_id: currentFlow,
      code: code.value.trim(),
    });
    if (!result.ok) return showError(result.code);
    code.value = "";
    showNotice("passkeyQa.notice.otpLoggedIn");
  } catch {
    showError("network");
  } finally {
    running.value = "";
  }
}

// The request flow ID is opaque; keep it in memory only for the current browser tab.
let currentFlow = "";

async function register() {
  if (!workflow.value) return;
  await withCeremony("register", async (signal, onPhase) => {
    const result = await workflow.value?.register(signal, onPhase);
    if (!result) return;
    if (!result.ok) return showError(result.code);
    showNotice("passkeyQa.notice.registered");
    await loadCredentials();
  });
}

async function login() {
  if (!workflow.value) return;
  await withCeremony("login", async (signal, onPhase) => {
    const result = await workflow.value?.login(signal, onPhase);
    if (!result) return;
    if (!result.ok) return showError(result.code);
    showNotice("passkeyQa.notice.loggedIn");
    await loadCredentials();
  });
}

async function revoke(id: string) {
  if (!workflow.value) return;
  const result = await workflow.value.revoke(id);
  if (!result.ok) return showError(result.code);
  showNotice("passkeyQa.notice.revoked");
  await loadCredentials();
}

async function logout() {
  const result = await getAuthClient().logout();
  if (!result.ok) return showError(result.code);
  credentials.value = [];
  showNotice("passkeyQa.notice.loggedOut");
}

function cancel() {
  cancelController.value?.abort();
}

function format(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat(locale.value).format(new Date(value))
    : t("passkeyQa.never");
}

onMounted(async () => {
  const auth = getAuthClient();
  workflow.value = getPasskeyWorkflow();
  supported.value = workflow.value.supported();
  unsubscribe = auth.subscribe((next) => {
    snapshot.value = next;
    if (next.status === "guest") credentials.value = [];
    if (next.status === "authenticated") void loadCredentials();
  });
  stop = auth.start();
  const outcome = await workflow.value.settle();
  outcomeNotice(outcome);
  if (snapshot.value.status === "authenticated") void loadCredentials();
});

onBeforeUnmount(() => {
  unsubscribe();
  stop();
});

useSeoMeta({
  title: () => t("passkeyQa.title"),
  robots: "noindex,nofollow",
});
</script>

<template>
  <section
    class="passkey-qa page-container"
    :data-web-authn="supported ? 'supported' : 'unsupported'"
  >
    <UiCard
      as="article"
      surface="glass-elevated"
      class="passkey-qa__card"
      aria-labelledby="passkey-qa-title"
    >
      <header class="passkey-qa__header">
        <p class="passkey-qa__flag">{{ t("passkeyQa.testOnly") }}</p>
        <h1 id="passkey-qa-title">{{ t("passkeyQa.title") }}</h1>
        <p class="passkey-qa__hint">{{ t("passkeyQa.description") }}</p>
      </header>

      <p v-if="!supported" class="passkey-qa__unsupported" role="alert">
        {{ t("passkeyQa.error.unsupported") }}
      </p>

      <section class="passkey-qa__section" aria-labelledby="passkey-qa-session">
        <h2 id="passkey-qa-session">{{ t("passkeyQa.session") }}</h2>
        <p class="passkey-qa__status" data-testid="qa-status" :data-status="snapshot.status">
          <template v-if="snapshot.status === 'authenticated' && snapshot.identity">
            {{ t("passkeyQa.authenticated") }}
            <strong data-testid="qa-identity">{{ snapshot.identity.user }}</strong>
          </template>
          <template v-else-if="snapshot.status === 'guest'">{{ t("passkeyQa.guest") }}</template>
          <template v-else>{{ t("passkeyQa.checking") }}</template>
        </p>
        <p v-if="snapshot.needsReconciliation" class="passkey-qa__warning" role="status">
          {{ t("passkeyQa.reconcile") }}
        </p>
        <div class="passkey-qa__actions">
          <UiButton
            data-testid="qa-logout"
            variant="secondary"
            :disabled="Boolean(running)"
            @click="logout"
          >
            {{ t("passkeyQa.logout") }}
          </UiButton>
        </div>
      </section>

      <section class="passkey-qa__section" aria-labelledby="passkey-qa-otp">
        <h2 id="passkey-qa-otp">{{ t("passkeyQa.otpTitle") }}</h2>
        <div class="passkey-qa__grid">
          <UiField :control-id="'qa-email'" :label="t('passkeyQa.email')">
            <UiInput
              id="qa-email"
              v-model="email"
              data-testid="qa-email"
              type="email"
              autocomplete="email"
            />
          </UiField>
          <UiField :control-id="'qa-invitation'" :label="t('passkeyQa.invitation')">
            <UiInput
              id="qa-invitation"
              v-model="invitation"
              data-testid="qa-invitation"
              autocomplete="off"
            />
          </UiField>
        </div>
        <div class="passkey-qa__actions">
          <UiButton
            data-testid="qa-request-code"
            variant="secondary"
            :loading="running === 'request'"
            @click="requestCodeWithFlow"
          >
            {{ t("passkeyQa.requestCode") }}
          </UiButton>
        </div>
        <div class="passkey-qa__grid">
          <UiField :control-id="'qa-code'" :label="t('passkeyQa.code')">
            <UiInput
              id="qa-code"
              v-model="code"
              data-testid="qa-code"
              inputmode="numeric"
              autocomplete="one-time-code"
            />
          </UiField>
        </div>
        <div class="passkey-qa__actions">
          <UiButton data-testid="qa-verify-code" :disabled="Boolean(running)" @click="verifyCode">
            {{ t("passkeyQa.verifyCode") }}
          </UiButton>
        </div>
        <p class="passkey-qa__hint">{{ t("passkeyQa.otpHint") }}</p>
      </section>

      <section class="passkey-qa__section" aria-labelledby="passkey-qa-passkey">
        <h2 id="passkey-qa-passkey">{{ t("passkeyQa.passkeyTitle") }}</h2>
        <div class="passkey-qa__actions">
          <UiButton
            data-testid="qa-register"
            :disabled="!supported || Boolean(running)"
            :loading="running === 'register'"
            @click="register"
          >
            {{ t("passkeyQa.register") }}
          </UiButton>
          <UiButton
            data-testid="qa-login"
            variant="secondary"
            :disabled="!supported || Boolean(running)"
            :loading="running === 'login'"
            @click="login"
          >
            {{ t("passkeyQa.login") }}
          </UiButton>
          <UiButton
            data-testid="qa-cancel"
            variant="ghost"
            :disabled="!cancelable || !cancelController"
            @click="cancel"
          >
            {{ t("passkeyQa.cancel") }}
          </UiButton>
        </div>
        <p class="passkey-qa__hint">{{ t("passkeyQa.cancelHint") }}</p>
      </section>

      <section class="passkey-qa__section" aria-labelledby="passkey-qa-credentials">
        <div class="passkey-qa__section-heading">
          <h2 id="passkey-qa-credentials">{{ t("passkeyQa.credentials") }}</h2>
          <UiButton
            data-testid="qa-refresh"
            variant="ghost"
            size="sm"
            :disabled="Boolean(running)"
            @click="loadCredentials(true)"
          >
            {{ t("passkeyQa.refresh") }}
          </UiButton>
        </div>
        <p v-if="credentials.length === 0" class="passkey-qa__hint" data-testid="qa-empty">
          {{ t("passkeyQa.empty") }}
        </p>
        <ul v-else class="passkey-qa__credentials">
          <li
            v-for="credential in credentials"
            :key="credential.id"
            class="passkey-qa__credential"
            data-testid="qa-credential"
          >
            <div>
              <code class="passkey-qa__id">{{ credential.id }}</code>
              <p class="passkey-qa__meta">
                {{ t("passkeyQa.created") }} {{ format(credential.created_at) }}
              </p>
              <p class="passkey-qa__meta">
                {{ t("passkeyQa.lastUsed") }} {{ format(credential.last_used_at) }}
              </p>
              <p class="passkey-qa__meta">
                {{ t("passkeyQa.backup") }}
                {{
                  credential.backup_eligible
                    ? t("passkeyQa.backupEligible")
                    : t("passkeyQa.backupLocal")
                }}
                {{ credential.backup_state ? t("passkeyQa.backedUp") : t("passkeyQa.notBackedUp") }}
              </p>
            </div>
            <UiButton
              data-testid="qa-revoke"
              :data-credential="credential.id"
              variant="secondary"
              size="sm"
              :disabled="Boolean(running)"
              @click="revoke(credential.id)"
            >
              {{ t("passkeyQa.revoke") }}
            </UiButton>
          </li>
        </ul>
      </section>

      <p
        v-if="notice"
        class="passkey-qa__notice"
        data-testid="qa-message"
        :data-code="notice.code"
        :data-tone="notice.tone"
        :role="notice.tone === 'error' ? 'alert' : 'status'"
        aria-live="polite"
      >
        {{ t(notice.key) }}
      </p>
    </UiCard>
  </section>
</template>

<style scoped>
.passkey-qa {
  padding-block: clamp(5rem, 12vh, 8rem);
}
.passkey-qa__card {
  display: grid;
  gap: var(--neoverse-layout-gutter-inline);
  max-width: 52rem;
  padding: clamp(1.25rem, 3vw, 2.5rem);
}
.passkey-qa__header,
.passkey-qa__section {
  display: grid;
  gap: 0.75rem;
}
.passkey-qa__section {
  padding-top: 1.25rem;
  border-top: 1px solid var(--neoverse-color-border-subtle);
}
.passkey-qa__section-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.passkey-qa__hint,
.passkey-qa__meta {
  color: var(--neoverse-color-text-muted);
  font-size: var(--neoverse-font-size-sm);
}
.passkey-qa__hint,
.passkey-qa__status {
  line-height: var(--neoverse-line-height-relaxed);
}
.passkey-qa__grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
}
.passkey-qa__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}
.passkey-qa__credentials {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.passkey-qa__credential {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: flex-start;
  justify-content: space-between;
  overflow-wrap: anywhere;
  padding: 0.9rem;
  border: 1px solid var(--neoverse-color-border-default);
  border-radius: var(--neoverse-radius-md, 0.75rem);
}
.passkey-qa__warning {
  color: var(--neoverse-color-accent-secondary);
}
.passkey-qa__notice {
  padding: 0.75rem 1rem;
  border: 1px solid var(--neoverse-color-border-default);
  border-radius: var(--neoverse-radius-md, 0.75rem);
}
.passkey-qa__notice[data-tone="error"] {
  border-color: var(--neoverse-color-error, currentColor);
}
</style>
