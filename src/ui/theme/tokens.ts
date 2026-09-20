// Design tokens ported from web/src/styles/variables.css (pre-Expo web prototype).

export const palette = {
  saffron: '#FF9933',
  yellow: '#FFCC00',
  white: '#FFFFFF',
  black: '#1A1A1A',
  gray: '#F5F5F5',
  darkGray: '#333333',
} as const;

export const themes = {
  light: {
    bgPrimary: palette.white,
    bgSecondary: palette.gray,
    textPrimary: palette.black,
    textSecondary: palette.darkGray,
    accentPrimary: palette.saffron,
    accentSecondary: palette.yellow,
    cardShadowColor: 'rgba(0, 0, 0, 0.1)',
  },
  dark: {
    bgPrimary: palette.black,
    bgSecondary: palette.darkGray,
    textPrimary: palette.white,
    textSecondary: palette.gray,
    accentPrimary: palette.yellow, // yellow pops better on dark
    accentSecondary: palette.saffron,
    cardShadowColor: 'rgba(255, 153, 51, 0.2)', // saffron glow
  },
} as const;

export type ThemeName = keyof typeof themes;
export type Theme = (typeof themes)[ThemeName];
