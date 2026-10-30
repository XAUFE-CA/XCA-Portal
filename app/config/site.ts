export const SITE = {
  brand: { acronym: "XCA", name: "XAUFE Computer Association", mark: "/brand/ca-mark.svg" },
  routes: { home: "/", about: "/about" },
  themes: ["light", "dark", "system"],
  navigation: [
    { route: "home", label: "nav.home" },
    { route: "about", label: "nav.about" },
  ],
} as const;
