/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ctl: '#3b82f6',
        atl: '#ef4444',
        tsb: '#22c55e',
      },
    },
  },
  plugins: [],
}
