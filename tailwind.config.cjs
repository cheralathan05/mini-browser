/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/renderer/**/*.{ts,tsx,html,css}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Avenir Next", "SF Pro Display", "Segoe UI", "sans-serif"],
        serif: ["Iowan Old Style", "Palatino Linotype", "Georgia", "serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      boxShadow: {
        ambient: "0 24px 60px rgba(8, 15, 31, 0.35)",
        soft: "0 10px 30px rgba(12, 22, 41, 0.22)",
      },
      backgroundImage: {
        noise:
          "radial-gradient(circle at top, rgba(244, 160, 88, 0.14), transparent 30%), radial-gradient(circle at bottom right, rgba(96, 165, 250, 0.12), transparent 32%)",
      },
    },
  },
  plugins: [],
};
