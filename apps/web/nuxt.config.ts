import { AbyssPreset } from './theme/abyss-preset'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-18',
  modules: ['@primevue/nuxt-module'],
  css: [
    '@fontsource/cinzel/latin-600.css',
    '@fontsource/cinzel/latin-700.css',
    '~/assets/main.css',
    '~/assets/rooms.css',
  ],
  devtools: { enabled: false },
  typescript: { strict: true },
  build: { transpile: ['@babel/contracts'] },
  nitro: {
    experimental: { websocket: true },
    preset: 'node-server',
    externals: {
      inline: [
        '@babel/auth',
        '@babel/database',
        '@babel/contracts',
        '@babel/providers',
        '@babel/telemetry',
      ],
    },
  },
  app: {
    head: {
      title: 'Babel · AION2 Abyss',
      htmlAttrs: { lang: 'en', class: 'babel-dark' },
      meta: [
        {
          name: 'description',
          content: 'Original commander audio and multilingual subtitles for AION2.',
        },
        { name: 'color-scheme', content: 'dark' },
        { name: 'theme-color', content: '#0b0e1b' },
      ],
    },
  },
  runtimeConfig: {
    databaseUrl: '',
    databasePoolMax: 10,
    siteUrl: 'https://babel.juryquinn.com',
    betterAuthSecret: '',
    accessTeamDomain: '',
    accessAudience: '',
    providerEncryptionKey: '',
    mediaControlUrl: '',
    mediaControlSecret: '',
    discordClientId: '',
    discordClientSecret: '',
    discordBotToken: '',
  },
  primevue: {
    options: {
      theme: { preset: AbyssPreset, options: { darkModeSelector: '.babel-dark' } },
    },
    components: {
      include: [
        'Button',
        'Checkbox',
        'InputText',
        'Select',
        'SelectButton',
        'Tag',
        'Textarea',
      ],
    },
    directives: { include: [] },
    composables: { include: [] },
  },
})
