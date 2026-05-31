/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/renderer/**/*.{html,js,ts,jsx,tsx}",
    "./index.html"
  ],
  theme: {
    extend: {
      colors: {
        // Material Design color palette
        'material-bg': '#121212',
        'material-surface': '#1e1e1e',
        'material-surface-variant': '#2d2d2d',
        'material-primary': '#bb86fc',
        'material-primary-variant': '#3700b3',
        'material-secondary': '#03dac6',
        'material-error': '#cf6679',
        'material-warning': '#ffb74d',
        'material-success': '#81c784',
        'material-text': '#ffffff',
        'material-text-secondary': '#b3b3b3',
        'material-outline': '#444444',
        'material-hover': 'rgba(255, 255, 255, 0.04)',
        'material-active': 'rgba(255, 255, 255, 0.08)',
      },
      fontFamily: {
        'material': ['Roboto', 'Noto Sans', 'Segoe UI', 'sans-serif'],
        'mono': ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
