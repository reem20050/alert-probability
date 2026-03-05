import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Heebo', 'sans-serif'],
      },
      colors: {
        'prob-very-low': '#22c55e',
        'prob-low': '#84cc16',
        'prob-moderate': '#eab308',
        'prob-elevated': '#f97316',
        'prob-high': '#ef4444',
        'prob-very-high': '#dc2626',
        'prob-active': '#991b1b',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};

export default config;
