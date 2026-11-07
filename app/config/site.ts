export const SITE = {
  brand: {
    acronym: "XCA",
    name: "XAUFE Computer Association",
    mark: "/brand/ca-mark.svg",
    sharedUiMark: "/brand/neoverse-wordmark.svg",
  },
  routes: { home: "/", about: "/about" },
  themes: ["light", "dark", "system"],
  navigation: [
    { route: "home", label: "nav.home" },
    { route: "about", label: "nav.about" },
  ],
  links: {
    repository: "https://github.com/XAUFE-CA/XCA-Portal",
    license: "https://github.com/XAUFE-CA/XCA-Portal/blob/main/LICENSE",
    contentLicense: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    contributing: "https://github.com/XAUFE-CA/.github/blob/main/CONTRIBUTING.md",
    organization: "https://github.com/XAUFE-CA",
    author: "https://shenshijun.space",
    sharedUi: "https://github.com/SSJ-ZYJ/Neoverse-UI",
  },
} as const;
