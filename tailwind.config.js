/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./public/**/*.html', './public/*.js', './public/admin/*.js'],
  theme: {
    extend: {
      colors: {
        ink: '#08090b',
        surface: '#131418',
        elevated: '#1b1d22',
        sunken: '#0e0f12',
        line: '#26282e',
        line2: '#33363d',
        ink50: '#f4f4f5',
        muted: '#a1a1aa',
        soft: '#6b7280',
        brand: { DEFAULT: '#a3e635', soft: '#bef264', dark: '#4d7c0f' },
        ok: '#34d399',
        warn: '#fbbf24',
        danger: '#f87171',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { xl2: '1.125rem' },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
        glow: '0 0 0 1px rgba(163,230,53,0.15), 0 8px 30px -8px rgba(163,230,53,0.25)',
      },
      keyframes: {
        shake: {
          '10%, 90%': { transform: 'translateX(-5px)' },
          '20%, 80%': { transform: 'translateX(7px)' },
          '30%, 50%, 70%': { transform: 'translateX(-9px)' },
          '40%, 60%': { transform: 'translateX(9px)' },
        },
        pop: {
          '0%': { transform: 'scale(0.96)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        rise: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        shake: 'shake 0.4s',
        pop: 'pop 0.18s ease-out',
        rise: 'rise 0.3s ease-out both',
      },
    },
  },
  safelist: [
    'bg-brand', 'border-brand', 'border-soft', 'scale-110', 'animate-shake',
  ],
  plugins: [],
};
