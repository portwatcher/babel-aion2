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
        <a href="/admin">{{ t('administration') }}</a>
      </nav>
    </header>
    <NuxtPage />
    <footer class="site-footer">{{ t('footer') }}</footer>
  </div>
</template>
