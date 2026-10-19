<script setup lang="ts">
import type { RoomDirectory } from '@babel/contracts'

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
        <p class="eyebrow">AION2 深渊战</p>
        <h1>选择你的转播房间</h1>
        <p class="muted">听指挥、看字幕，在同一张地图上标出下一步。</p>
      </div>
      <Button as="a" href="/rooms/create" label="创建房间" />
    </div>
    <section v-if="error || !data?.available" class="empty-state" role="status">
      <h2>暂时无法加载房间</h2>
      <p class="muted">房间服务暂时不可用，请稍后重试。</p>
      <Button label="重新加载" severity="secondary" @click="refresh()" />
    </section>
    <section v-else aria-labelledby="rooms-title" class="room-directory">
      <div class="section-heading">
        <h2 id="rooms-title">
          转播房间 <span class="muted">{{ data.rooms.length }}</span>
        </h2>
        <InputText
          v-if="data.rooms.length"
          v-model="search"
          type="search"
          aria-label="搜索房间或区服"
          placeholder="搜索房间或区服"
        />
      </div>
      <div v-if="!data.rooms.length" class="empty-state lobby-empty">
        <h2>还没有转播房间</h2>
        <p class="muted">创建房间，将 Discord 语音频道与协作地图连接起来。</p>
      </div>
      <p v-else-if="!rooms.length" class="muted lobby-empty" role="status">
        没有匹配的房间，请试试其他名称或区服。
      </p>
      <ul v-else class="room-directory-list">
        <li v-for="room in rooms" :key="room.id">
          <div class="room-directory-identity">
            <h2>
              <NuxtLink :to="`/rooms/${room.id}`">{{ room.name }}</NuxtLink>
            </h2>
            <p class="muted">
              Asia / {{ room.server }} ·
              {{ room.restricted ? '指定角色可加入' : '本区服所有角色可加入' }}
            </p>
          </div>
          <div class="room-directory-status">
            <Tag
              :value="room.stopped ? '转播已停止' : '房间已开放'"
              severity="secondary"
            />
            <span class="muted">{{ room.memberCount }} 人在房间</span>
            <Button
              as="a"
              :href="`/rooms/${room.id}`"
              label="加入房间"
              severity="secondary"
            />
          </div>
        </li>
      </ul>
    </section>
  </main>
</template>
