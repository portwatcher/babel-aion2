import Aura from '@primeuix/themes/aura'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-18',
  modules: ['@primevue/nuxt-module'],
  css: ['~/assets/main.css', '~/assets/rooms.css'],
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
    options: { theme: { preset: Aura, options: { darkModeSelector: '.babel-dark' } } },
    components: {
      include: ['Button', 'Checkbox', 'InputText', 'Select', 'Tag', 'Textarea'],
    },
    directives: { include: [] },
    composables: { include: [] },
  },
})
