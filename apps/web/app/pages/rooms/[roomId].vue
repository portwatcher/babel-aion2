<script setup lang="ts">
import type { PublicRoomConfiguration } from '@babel/contracts'
import { audioStatus } from '~/utils/audio-status'
definePageMeta({ key: (route) => String(route.params.roomId) })
const route = useRoute()
const roomId = String(route.params.roomId)
const {
  data,
  error: configurationError,
  refresh,
} = await useFetch<PublicRoomConfiguration>(`/api/player/rooms/${roomId}/config`)
const configuration = shallowRef<PublicRoomConfiguration | null>(data.value ?? null)
watch(data, (value) => {
  configuration.value = value ?? null
})
const {
  session,
  credential,
  players,
  playersCurrent,
  restoring,
  restoreFailed,
  submitting,
  changingLanguage,
  error,
  notice,
  active,
  leavePending,
  connectionState,
  subtitles,
  audioState,
  audioBlocked,
  muted,
  playAudio,
  toggleMute,
  enter,
  restore,
  leave,
  changeLanguage,
} = usePlayerSession(configuration, roomId)
let configurationTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  configurationTimer = setInterval(() => void refresh(), 5_000)
})
onBeforeUnmount(() => clearInterval(configurationTimer))
</script>

<template>
  <main id="main" tabindex="-1" class="main-content">
    <div class="page-heading">
      <NuxtLink to="/" class="muted">← 房间列表</NuxtLink>
      <p class="eyebrow">指挥收听室</p>
      <h1>{{ configuration?.room.name ?? 'AION2 深渊战' }}</h1>
      <p class="muted">听见原声，跟上每一道指令。</p>
    </div>
    <section v-if="configurationError" class="empty-state" aria-live="polite">
      <h2>暂时无法获取房间状态</h2>
      <p>请检查网络连接，然后重试。</p>
      <Button label="重新加载" severity="secondary" @click="refresh()" />
    </section>
    <template v-else-if="configuration">
      <p v-if="notice" class="session-notice" role="status">{{ notice }}</p>
      <div v-if="error" class="session-feedback" role="alert">
        <p class="form-error">{{ error }}</p>
        <Button
          v-if="restoreFailed"
          label="重试恢复会话"
          severity="secondary"
          @click="restore"
        />
      </div>
      <div class="room-layout">
        <section v-if="restoring" class="entry-panel" aria-busy="true">
          <p>正在恢复本页连接…</p>
        </section>
        <section v-else-if="leavePending" class="entry-panel">
          <p>本页连接已停止。</p>
          <Button
            label="重试退出"
            severity="secondary"
            :loading="submitting"
            @click="leave"
          />
        </section>
        <ListenerPanel
          v-else-if="active && session"
          :session="session"
          :configuration="configuration"
          :connection-state="connectionState"
          :subtitles="subtitles"
          :audio-state="audioState"
          :audio-blocked="audioBlocked"
          :muted="muted"
          :busy="submitting"
          :changing-language="changingLanguage"
          @leave="leave"
          @language="changeLanguage"
          @play-audio="playAudio"
          @toggle-mute="toggleMute"
        />
        <RoomEntry
          v-else
          :configuration="configuration"
          :submitting="submitting"
          @enter="enter"
        />
        <div class="room-detail">
          <section class="room-detail" aria-labelledby="room-status-title">
            <div class="section-heading">
              <h2 id="room-status-title">频道状态</h2>
              <Tag
                :value="audioStatus[configuration.room.audioState].label"
                severity="secondary"
              />
            </div>
            <p class="muted">
              {{ audioStatus[configuration.room.audioState].description }}
            </p>
          </section>
          <div class="detail-divider" />
          <PlayerList :players="players" :current="playersCurrent" />
        </div>
      </div>
      <TacticalMap
        :room-id="roomId"
        :session="active ? session : null"
        :credential="credential"
      />
    </template>
  </main>
</template>
