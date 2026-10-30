import { defineCollection, defineContentConfig, z } from "@nuxt/content";

export default defineContentConfig({
  collections: {
    about: defineCollection({
      type: "page",
      source: "pages/about/*.md",
      schema: z.object({
        locale: z.enum(["zh-CN", "en"]),
        title: z.string().min(1),
        description: z.string().min(1),
        banner: z.object({
          light: z.string().min(1),
          dark: z.string().min(1),
          alt: z.string().min(1),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
        }),
      }),
    }),
  },
});
