import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
        },
      },
      fontSize: {
        "simple-base": ["1.5rem", { lineHeight: "2rem" }],
        "simple-lg": ["1.75rem", { lineHeight: "2.25rem" }],
        "simple-xl": ["2rem", { lineHeight: "2.5rem" }],
      },
    },
  },
  plugins: [],
} satisfies Config;
