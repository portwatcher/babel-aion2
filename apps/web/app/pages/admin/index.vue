<script setup lang="ts">
definePageMeta({ middleware: 'administrator' })
useHead({ title: 'Website administration · Babel' })
const { status, loading, error, connect } = useAdministratorStatus()
</script>

<template>
  <main id="main" tabindex="-1" class="main-content">
    <div class="page-heading">
      <h1>Website administration</h1>
      <p class="muted">
        {{ status?.administrator.email ?? 'Establishing administrator session…' }}
      </p>
    </div>
    <section v-if="error" class="empty-state" aria-live="polite">
      <h2>Administrator session unavailable</h2>
      <p>{{ error }}</p>
      <Button label="Retry" severity="secondary" :loading="loading" @click="connect" />
    </section>
    <template v-else-if="status">
      <AdminProviders />
      <AdminTerms />
    </template>
  </main>
</template>
