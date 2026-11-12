<script setup lang="ts">
import { SITE } from "~/config/site";
import { ContextMenuHost, useLinkMenu } from "~/features/context-menu";
import { TaglineFlame } from "~/features/tagline-flame";
import { translate } from "~/i18n";
import { copyrightYears } from "~/utils/copyright";

const { t } = useSiteLocale();
// The quotation is independent of the site language: both versions ship, and it opens in English.
// 引语不跟随站点语言：两种文案随组件提供，始终从英文开始。
const taglineTexts = {
  en: translate("en", "footer.tagline"),
  "zh-CN": translate("zh-CN", "footer.tagline"),
} as const;
const build = useRuntimeConfig().public.buildInfo;
// Resolve the year once during SSR so the hydration payload carries the same value.
// 年份在 SSR 解析一次，使水合数据携带同一个值。
const currentYear = useState<number>("xca-copyright-year", () => new Date().getFullYear());
const years = copyrightYears(currentYear.value);
// Print the short SHA with the commit time in one parenthesized stamp, like the repository.
// 把短 SHA 与提交时间打印成一个括号时间戳，与仓库记录一致。
const commitStamp = build
  ? build.committedAt
    ? `(${build.shortSha} @ ${build.committedAt})`
    : `(${build.shortSha})`
  : "";
// External destinations keep the current page, matching the about-page action links.
// 外部目标保留当前页面，与关于学社的操作链接一致。
const external = { target: "_blank", rel: "noopener noreferrer" } as const;
const menu = useLinkMenu();
</script>

<template>
  <footer class="site-footer page-container" :ref="menu.regionRef">
    <ContextMenuHost :menu="menu" />
    <div class="site-footer__top">
      <div class="site-footer__identity">
        <div class="site-footer__lockup" role="img" :aria-label="t('footer.coBrandLabel')">
          <img class="site-footer__mark" :src="SITE.brand.mark" alt="">
          <span class="site-footer__lockup-divider" aria-hidden="true" />
          <img class="site-footer__wordmark" :src="SITE.brand.sharedUiMark" alt="">
        </div>
        <p class="site-footer__meta">
          <span class="site-footer__shared-ui">
            {{ t("footer.sharedUiLead") }}
            <a v-bind="external" :href="SITE.links.sharedUi">{{ t("footer.sharedUi") }}</a>
            {{ t("footer.sharedUiTail") }}
          </span>
          <template v-if="build">
            <span class="site-footer__build">
              {{ t("footer.buildLabel") }}
              <a
                v-bind="external"
                class="site-footer__build-status"
                :href="SITE.links.repository"
                >{{
                  t("footer.buildStatus")
                }}</a
              >
              <a
                v-bind="external"
                :href="build.commitUrl"
                :aria-label="t('footer.buildCommitLabel', { sha: build.shortSha })"
                >{{
                  commitStamp
                }}</a
              >
            </span>
          </template>
        </p>
      </div>
      <TaglineFlame
        class="site-footer__tagline"
        :texts="taglineTexts"
        :hint="t('footer.taglineHint')"
      />
    </div>
    <div class="site-footer__bottom">
      <p class="site-footer__copyright">
        <span>{{ t("footer.copyright", { years }) }}</span>
        <a v-bind="external" :href="SITE.links.organization">{{ t("footer.copyrightOrg") }}</a>
        <span aria-hidden="true">|</span>
        <a v-bind="external" :href="SITE.links.author">{{ t("footer.copyrightAuthor") }}</a>
      </p>
      <p class="site-footer__licenses">
        <span class="site-footer__license">
          {{ t("footer.licenseCodeLead") }}
          <a v-bind="external" :href="SITE.links.license">{{ t("footer.licenseCode") }}</a>
          {{ t("footer.licenseCodeTail") }}
        </span>
        <span class="site-footer__license">
          {{ t("footer.licenseContentLead") }}
          <a v-bind="external" :href="SITE.links.contentLicense">
            {{ t("footer.licenseContent") }}
          </a>
          {{ t("footer.licenseContentTail") }}
        </span>
      </p>
    </div>
  </footer>
</template>
