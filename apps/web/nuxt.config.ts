import Aura from '@primeuix/themes/aura'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-18',
  modules: ['@primevue/nuxt-module'],
  css: ['~/assets/main.css'],
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
      title: 'Babel · AION2 深渊站',
      htmlAttrs: { lang: 'zh-CN', class: 'babel-dark' },
      meta: [
        { name: 'description', content: 'AION2 原声指挥与多语言字幕。' },
        { name: 'color-scheme', content: 'dark' },
      ],
    },
  },
  runtimeConfig: {
    databaseUrl: '',
    siteUrl: 'https://babel.juryquinn.com',
    betterAuthSecret: '',
    accessTeamDomain: '',
    accessAudience: '',
    providerEncryptionKey: '',
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
