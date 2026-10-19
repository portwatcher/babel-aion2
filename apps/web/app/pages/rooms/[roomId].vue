<script setup lang="ts">
import type { PublicRoomConfiguration } from '@babel/contracts'
import { audioStatus } from '~/utils/audio-status'
const { t } = useInterfaceLocale()
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
      <NuxtLink to="/" class="muted">{{ t('backRooms') }}</NuxtLink>
      <p class="eyebrow">{{ t('roomEyebrow') }}</p>
      <h1>{{ configuration?.room.name ?? t('directoryEyebrow') }}</h1>
      <p class="muted">{{ t('roomTagline') }}</p>
    </div>
    <section v-if="configurationError" class="empty-state" aria-live="polite">
      <h2>{{ t('configurationUnavailable') }}</h2>
      <p>{{ t('checkConnection') }}</p>
      <Button :label="t('reload')" severity="secondary" @click="refresh()" />
    </section>
    <template v-else-if="configuration">
      <p v-if="notice" class="session-notice" role="status">{{ notice }}</p>
      <div v-if="error" class="session-feedback" role="alert">
        <p class="form-error">{{ error }}</p>
        <Button
          v-if="restoreFailed"
          :label="t('retryRestore')"
          severity="secondary"
          @click="restore"
        />
      </div>
      <div class="room-layout">
        <section v-if="restoring" class="entry-panel" aria-busy="true">
          <p>{{ t('restoring') }}</p>
        </section>
        <section v-else-if="leavePending" class="entry-panel">
          <p>{{ t('connectionStopped') }}</p>
          <Button
            :label="t('retryLeave')"
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
              <h2 id="room-status-title">{{ t('channelStatus') }}</h2>
              <Tag
                :value="t(audioStatus[configuration.room.audioState].label)"
                severity="secondary"
              />
            </div>
            <p class="muted">
              {{ t(audioStatus[configuration.room.audioState].description) }}
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
