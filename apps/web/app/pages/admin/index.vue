<script setup lang="ts">
import type { ProviderSummary } from '@babel/contracts'

definePageMeta({
  middleware: 'administrator',
  key: (route) => String(route.query.roomId ?? 'default'),
})
const route = useRoute()
const { data: directory } = await useFetch('/api/player/rooms')
if (!route.query.roomId && directory.value?.rooms[0]) {
  await navigateTo(
    { path: '/admin', query: { roomId: directory.value.rooms[0].id } },
    { replace: true },
  )
}
const selectedRoomId = computed(() =>
  typeof route.query.roomId === 'string'
    ? route.query.roomId
    : (directory.value?.rooms[0]?.id ?? null),
)
const roomChoices = computed(() => directory.value?.rooms ?? [])
async function selectRoom(id: string | null) {
  await navigateTo({ path: '/admin', query: id ? { roomId: id } : {} })
}
useHead({ title: 'Administration · Babel' })
const { status, loading, error, connect } = useAdministratorStatus()
const terminologyVersion = ref<number | null>(null)
const providers = shallowRef<ProviderSummary[]>([])
</script>

<template>
  <main id="main" tabindex="-1" class="main-content">
    <div class="page-heading">
      <h1>Administration</h1>
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
      <div v-if="roomChoices.length" class="field management-section">
        <label for="management-room">Managed room</label>
        <Select
          input-id="management-room"
          :model-value="selectedRoomId"
          :options="roomChoices"
          option-label="name"
          option-value="id"
          @update:model-value="selectRoom"
        />
      </div>
      <template v-if="selectedRoomId">
        <AdminRoomSettings />
        <AdminListeners />
      </template>
      <p v-else class="muted">
        No rooms yet. <a href="/rooms/create">Create a room</a>
      </p>
      <AdminProviders
        :terminology-version="terminologyVersion"
        @change="providers = $event"
      />
      <AdminLanguages
        v-if="selectedRoomId"
        :providers="providers"
        :terminology-version="terminologyVersion"
      />
      <AdminTerms @version="terminologyVersion = $event" />
      <section
        class="room-detail"
        :aria-busy="loading"
        aria-labelledby="services-title"
      >
        <h2 id="services-title">Subtitle worker</h2>
        <p class="muted">
          {{ status.services.subtitles === 'READY' ? 'Ready' : 'Unavailable' }}
        </p>
      </section>
    </template>
  </main>
</template>
