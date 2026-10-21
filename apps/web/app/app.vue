<script setup lang="ts">
const { t, administrator } = useInterfaceLocale()
useInterfaceControlLocale()
</script>

<template>
  <a class="skip-link" href="#main">{{ t('skipContent') }}</a>
  <div class="site-shell">
    <header class="site-header">
      <NuxtLink to="/" class="site-title" :aria-label="t('home')">Babel</NuxtLink>
      <span class="site-context">AION2 · Global / Asia</span>
      <nav :aria-label="t('navigation')">
        <InterfaceLocaleSelect v-if="!administrator" />
        <Button
          as="a"
          href="https://github.com/portwatcher/babel-aion2"
          class="github-link"
          variant="text"
          severity="secondary"
          :aria-label="t('githubRepository')"
          :title="t('githubRepository')"
        >
          <img
            src="/brands/github-mark-white.svg"
            alt=""
            aria-hidden="true"
            width="24"
            height="24"
          />
        </Button>
      </nav>
    </header>
    <NuxtPage />
  </div>
  <Toast position="top-center" />
</template>
