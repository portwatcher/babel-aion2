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
      <nav v-if="!administrator" :aria-label="t('navigation')">
        <InterfaceLocaleSelect />
      </nav>
    </header>
    <NuxtPage />
  </div>
  <Toast position="top-center" />
</template>
