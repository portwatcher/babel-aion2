<script setup lang="ts">
import type { RoomDirectory } from '@babel/contracts'

const { t } = useInterfaceLocale()
const { data, error, refresh } = await useFetch<RoomDirectory>('/api/player/rooms')
const search = ref('')
const rooms = computed(() =>
  (data.value?.rooms ?? []).filter((room) =>
    `${room.name} ${room.server}`
      .toLocaleLowerCase()
      .includes(search.value.trim().toLocaleLowerCase()),
  ),
)
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => void refresh(), 5_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <main id="main" tabindex="-1" class="main-content">
    <div class="page-heading directory-heading">
      <div class="page-heading-copy">
        <p class="eyebrow">{{ t('directoryEyebrow') }}</p>
        <h1>{{ t('chooseRoom') }}</h1>
        <p class="muted">{{ t('lobbyTagline') }}</p>
      </div>
      <Button as="a" href="/rooms/create" :label="t('createRoom')" />
    </div>
    <section v-if="error || !data?.available" class="empty-state" role="status">
      <h2>{{ t('roomsUnavailableTitle') }}</h2>
      <p class="muted">{{ t('roomsUnavailable') }}</p>
      <Button :label="t('reload')" severity="secondary" @click="refresh()" />
    </section>
    <section v-else aria-labelledby="rooms-title" class="room-directory">
      <div class="section-heading">
        <h2 id="rooms-title">
          {{ t('broadcastRooms') }} <span class="muted">{{ data.rooms.length }}</span>
        </h2>
        <InputText
          v-if="data.rooms.length"
          v-model="search"
          type="search"
          :aria-label="t('searchRooms')"
          :placeholder="t('searchRooms')"
        />
      </div>
      <div v-if="!data.rooms.length" class="empty-state lobby-empty">
        <h2>{{ t('noRoomsTitle') }}</h2>
        <p class="muted">{{ t('noRoomsHelp') }}</p>
      </div>
      <p v-else-if="!rooms.length" class="muted lobby-empty" role="status">
        {{ t('noMatchingRooms') }}
      </p>
      <ul v-else class="room-directory-list">
        <li v-for="room in rooms" :key="room.id">
          <div class="room-directory-identity">
            <h2>
              <NuxtLink :to="`/rooms/${room.number}`">{{ room.name }}</NuxtLink>
            </h2>
            <p class="muted">
              Asia / {{ room.server }} ·
              {{ room.restricted ? t('restrictedCharacters') : t('allCharacters') }}
            </p>
          </div>
          <div class="room-directory-status">
            <Tag
              :value="room.stopped ? t('broadcastStopped') : t('roomOpen')"
              severity="secondary"
            />
            <span class="muted">{{
              t('roomMemberCount', { count: room.memberCount })
            }}</span>
            <Button
              as="a"
              :href="`/rooms/${room.number}`"
              :label="t('joinRoomLink')"
              severity="secondary"
            />
          </div>
        </li>
      </ul>
    </section>
  </main>
</template>
