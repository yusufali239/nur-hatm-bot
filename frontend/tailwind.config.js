/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          '"Inter"',
          'system-ui',
          'sans-serif',
        ],
      },
      colors: {
        ios: {
          bgStart: '#0A0A0F',
          bgEnd: '#1A1A2E',
          glass: 'rgba(255, 255, 255, 0.06)',
          glassBorder: 'rgba(255, 255, 255, 0.12)',
          gold: '#F5C451',
          emerald: '#10B981',
        },
      },
      boxShadow: {
        'liquid': '0 8px 32px 0 rgba(0, 0, 0, 0.45), inset 0 1px 1px 0 rgba(255, 255, 255, 0.18)',
        'liquid-emerald': '0 10px 30px -5px rgba(16, 185, 129, 0.35), inset 0 1px 1px 0 rgba(16, 185, 129, 0.4)',
        'liquid-gold': '0 10px 32px -4px rgba(245, 196, 81, 0.42), inset 0 1px 2px 0 rgba(255, 240, 180, 0.55)',
        'liquid-selected': '0 10px 30px -4px rgba(56, 189, 248, 0.45), inset 0 1px 2px 0 rgba(186, 230, 253, 0.6)',
      },
    },
  },
  plugins: [],
};
