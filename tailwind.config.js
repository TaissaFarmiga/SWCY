/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        hydro: {
          blue: '#007AFF',
          'blue-dark': '#0055CC',
          'blue-light': '#4DA3FF',
        },
        glass: {
          bg: '#F2F2F7',
          panel: 'rgba(255, 255, 255, 0.6)',
          border: 'rgba(255, 255, 255, 0.8)',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['SF Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      backdropBlur: { xs: '2px', '3xl': '64px' },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(0, 122, 255, 0.05)',
        'glass-lg': '0 16px 48px 0 rgba(0, 122, 255, 0.08)',
        'glass-inset': 'inset 0 0 0 1px rgba(255, 255, 255, 0.8)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { transform: 'translateY(10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        slideDown: { '0%': { transform: 'translateY(-10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        scaleIn: { '0%': { transform: 'scale(0.95)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
      },
    },
  },
  plugins: [],
};