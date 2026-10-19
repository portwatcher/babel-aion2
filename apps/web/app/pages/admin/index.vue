<script setup lang="ts">
import type { ProviderSummary } from '@babel/contracts'

definePageMeta({ middleware: 'administrator' })
useHead({ title: 'Administration · Babel' })
const { status, loading, error, connect } = useAdministratorStatus()
const terminologyVersion = ref<number | null>(null)
const providers = shallowRef<ProviderSummary[]>([])
</script>

<template>
  <main id="main" tabindex="-1" class="main-content">
    <div class="page-heading">
      <p class="eyebrow">Administrator</p>
      <h1>Room administration</h1>
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
      <AdminRoomSettings />
      <AdminListeners />
      <AdminProviders
        :terminology-version="terminologyVersion"
        @change="providers = $event"
      />
      <AdminLanguages
        :providers="providers"
        :terminology-version="terminologyVersion"
      />
      <AdminTerms @version="terminologyVersion = $event" />
      <section
        class="room-detail"
        :aria-busy="loading"
        aria-labelledby="services-title"
      >
        <h2 id="services-title">Services</h2>
        <p class="muted">
          Original audio status appears in room settings. Configure and validate
          subtitle services separately.
        </p>
        <dl class="service-list">
          <div>
            <dt>Discord commander audio</dt>
            <dd>Controlled by the room source</dd>
          </div>
          <div>
            <dt>Player audio delivery</dt>
            <dd>Delivered through the listening channel</dd>
          </div>
          <div>
            <dt>Recognition and translation</dt>
            <dd>
              {{
                status.services.subtitles === 'READY'
                  ? 'Subtitle processing ready'
                  : 'Subtitle worker unavailable'
              }}
            </dd>
          </div>
          <div>
            <dt>Subtitle languages</dt>
            <dd>Controlled by output language settings</dd>
          </div>
        </dl>
      </section>
    </template>
  </main>
</template>
