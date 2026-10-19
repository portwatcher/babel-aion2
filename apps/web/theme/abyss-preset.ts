import { definePreset } from '@primeuix/themes'
import Aura from '@primeuix/themes/aura'

// AION2 Abyss: aether gold on a deep void indigo. Keep these values aligned
// with the --babel-* tokens in app/assets/main.css.
const aetherGold = {
  50: '#fbf7ec',
  100: '#f5ecd0',
  200: '#ecd9a3',
  300: '#e1c275',
  400: '#d6ad55',
  500: '#c8963c',
  600: '#ab7a2f',
  700: '#8a5f28',
  800: '#6f4c25',
  900: '#5c3f22',
  950: '#33210f',
}

const abyssSurface = {
  0: '#ffffff',
  50: '#f3f4f9',
  100: '#e3e6f0',
  200: '#c6cbdc',
  300: '#a3aac2',
  400: '#8a92ad',
  500: '#646b89',
  600: '#474e6b',
  700: '#30364f',
  800: '#1d2238',
  900: '#131729',
  950: '#0b0e1b',
}

export const AbyssPreset = definePreset(Aura, {
  semantic: {
    primary: aetherGold,
    colorScheme: {
      dark: {
        surface: abyssSurface,
        primary: {
          color: '{primary.400}',
          contrastColor: '{surface.950}',
          hoverColor: '{primary.300}',
          activeColor: '{primary.200}',
        },
      },
    },
  },
  components: {
    togglebutton: {
      colorScheme: {
        dark: {
          root: {
            background: '{surface.950}',
            hoverBackground: '{surface.950}',
            checkedBackground: '{surface.950}',
            borderColor: '{surface.700}',
            checkedBorderColor: '{primary.700}',
            checkedColor: '{primary.200}',
          },
          content: {
            checkedBackground: 'color-mix(in srgb, {primary.400}, transparent 78%)',
          },
          icon: { checkedColor: '{primary.200}' },
        },
      },
    },
  },
})
