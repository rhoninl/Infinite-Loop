/**
 * PostCSS pipeline for InfLoop's HeroUI + Tailwind foundation. Tailwind v3
 * needs to run before autoprefixer; we keep the list short and explicit so
 * future workers can see at a glance what touches the CSS.
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
