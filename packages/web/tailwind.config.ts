import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(0 0% 100%)",
        foreground: "hsl(222 47% 11%)",
        muted: "hsl(210 40% 96%)",
        "muted-foreground": "hsl(215 16% 47%)",
        border: "hsl(214 32% 91%)",
        primary: "hsl(222 47% 11%)",
        "primary-foreground": "hsl(210 40% 98%)",
        destructive: "hsl(0 84% 60%)",
        "destructive-foreground": "hsl(210 40% 98%)",
        warning: "hsl(38 92% 50%)",
        "warning-foreground": "hsl(222 47% 11%)",
        success: "hsl(142 71% 45%)",
        "success-foreground": "hsl(210 40% 98%)",
        info: "hsl(204 94% 47%)",
        "info-foreground": "hsl(210 40% 98%)",
      },
    },
  },
  plugins: [],
};

export default config;
