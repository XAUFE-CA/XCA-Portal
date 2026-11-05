import { markSessionEntry } from "~/features/intro";

export default defineNuxtPlugin(() => {
  // Only the pre-navigation URL identifies the page this session entered on.
  // 只有跳转前的地址能标识本次会话进入的页面。
  markSessionEntry(window.location.pathname);
});
