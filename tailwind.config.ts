import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: "#F6F8FB",
          surface: "#FFFFFF",
          copper: "#A7674E",
          hover: "#B07050",
          text: "#0A1D4A",
          secondary: "#6B738A",
          muted: "#6B738A",
          border: "#E2E7EF",
        },
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
    },
  },
  plugins: [],
};
export default config;
