/**
 * InfraAlert design tokens. See DESIGN.md for how to use them.
 * Palette: road signage and fieldwork — asphalt ink, concrete paper,
 * hi-vis signal yellow for action, safety orange for danger.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14161a',
        asphalt: {
          900: '#14161a',
          800: '#1d2025',
          700: '#2a2e35',
          600: '#3d424b',
          500: '#565c66',
          400: '#7b818b',
        },
        concrete: {
          50: '#faf8f3',
          100: '#f3f0e8',
          200: '#e7e2d6',
          300: '#d5cebf',
          400: '#b5ad9b',
        },
        signal: {
          100: '#fff6c2',
          200: '#ffec80',
          300: '#ffe14d',
          400: '#ffd60a',
          500: '#f2c500',
          600: '#c79f00',
        },
        hazard: {
          50: '#fff1ea',
          100: '#ffdccb',
          500: '#ff5a1f',
          600: '#e5480f',
          700: '#b8380a',
        },
        go: {
          50: '#e9f7ef',
          100: '#c9ecd7',
          500: '#22a35a',
          600: '#1a8a4b',
          700: '#136b3a',
        },
        survey: {
          50: '#eef3ff',
          500: '#2f5bff',
          600: '#1f45e0',
        },
      },
      fontFamily: {
        sans: ['Overpass', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"Overpass Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        sign: '0.14em',
      },
      boxShadow: {
        // A sign plate's raised bottom edge.
        plate: '0 3px 0 0 #14161a',
        'plate-sm': '0 2px 0 0 #14161a',
        lift: '0 1px 2px rgb(20 22 26 / 0.06), 0 8px 24px -12px rgb(20 22 26 / 0.25)',
      },
      backgroundImage: {
        // Lane marking: yellow dashes on asphalt.
        lane: 'repeating-linear-gradient(90deg, #ffd60a 0 28px, transparent 28px 48px)',
        // Hazard stripes for the emergency edge.
        hazard:
          'repeating-linear-gradient(-45deg, #14161a 0 10px, #ff5a1f 10px 20px)',
        // Survey grid dots for the page background.
        grid: 'radial-gradient(circle at 1px 1px, rgb(20 22 26 / 0.07) 1px, transparent 0)',
      },
      backgroundSize: {
        grid: '22px 22px',
      },
      keyframes: {
        beacon: {
          '0%': { boxShadow: '0 0 0 0 rgb(255 214 10 / 0.7)' },
          '70%': { boxShadow: '0 0 0 10px rgb(255 214 10 / 0)' },
          '100%': { boxShadow: '0 0 0 0 rgb(255 214 10 / 0)' },
        },
        'rise-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        beacon: 'beacon 2s ease-out infinite',
        'rise-in': 'rise-in 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both',
      },
    },
  },
  plugins: [],
}
