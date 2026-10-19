<script setup lang="ts">
const { t, administrator } = useInterfaceLocale()
useInterfaceControlLocale()
defineProps<{ error: { statusCode: number; message: string } }>()
</script>

<template>
  <main class="error-page">
    <InterfaceLocaleSelect v-if="!administrator" />
    <p class="eyebrow">Babel · {{ error.statusCode }}</p>
    <h1>{{ t('errorTitle') }}</h1>
    <p class="muted">
      {{ error.statusCode === 404 ? t('errorNotFound') : t('errorUnavailable') }}
    </p>
    <a href="/">{{ t('returnRoom') }}</a>
  </main>
</template>
