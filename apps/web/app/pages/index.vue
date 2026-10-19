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
      <h1>
        {{ t('chooseRoom') }}
        <span v-if="data?.available && data.rooms.length" class="heading-count">{{
          data.rooms.length
        }}</span>
      </h1>
      <div class="directory-actions">
        <InputText
          v-if="data?.available && data.rooms.length"
          v-model="search"
          type="search"
          :aria-label="t('searchRooms')"
          :placeholder="t('searchRooms')"
        />
        <Button as="a" href="/rooms/create" :label="t('createRoom')" />
      </div>
    </div>
    <section v-if="error || !data?.available" class="empty-state" role="status">
      <p>{{ t('roomsUnavailable') }}</p>
      <Button :label="t('reload')" severity="secondary" @click="refresh()" />
    </section>
    <div v-else-if="!data.rooms.length" class="empty-state">
      <h2>{{ t('noRoomsTitle') }}</h2>
      <p class="muted">{{ t('noRoomsHelp') }}</p>
    </div>
    <p v-else-if="!rooms.length" class="muted empty-state" role="status">
      {{ t('noMatchingRooms', { query: search.trim() }) }}
    </p>
    <ul v-else class="room-directory-list">
      <li v-for="room in rooms" :key="room.id">
        <div class="room-directory-identity">
          <h2>{{ room.name }}</h2>
          <p class="muted">
            {{ room.server
            }}<template v-if="room.restricted">
              · {{ t('restrictedCharacters') }}</template
            >
          </p>
        </div>
        <div class="room-directory-status">
          <Tag
            v-if="room.stopped"
            :value="t('broadcastStopped')"
            severity="secondary"
          />
          <span class="muted">{{
            t('roomMemberCount', { count: room.memberCount })
          }}</span>
          <Button
            as="a"
            :href="`/rooms/${room.id}`"
            :label="t('joinRoomLink')"
            :aria-label="`${t('joinRoomLink')} ${room.name}`"
            severity="secondary"
          />
        </div>
      </li>
    </ul>
  </main>
</template>
