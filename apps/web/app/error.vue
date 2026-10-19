<script setup lang="ts">
const { t, administrator } = useInterfaceLocale()
useInterfaceControlLocale()
defineProps<{ error: { statusCode: number; message: string } }>()
</script>

<template>
  <main class="error-page">
    <InterfaceLocaleSelect v-if="!administrator" class="error-locale" />
    <p class="muted">{{ error.statusCode }}</p>
    <h1>{{ t('errorTitle') }}</h1>
    <p class="muted">
      {{ error.statusCode === 404 ? t('errorNotFound') : t('errorUnavailable') }}
    </p>
    <Button as="a" href="/" :label="t('returnRoom')" severity="secondary" />
  </main>
</template>
