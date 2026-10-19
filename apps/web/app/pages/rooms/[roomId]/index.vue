<script setup lang="ts">
import { audioStatus } from '~/utils/audio-status'
const { t } = useInterfaceLocale()
const {
  roomNumber,
  configuration,
  session,
  credential,
  active,
  restoring,
  players,
  playersCurrent,
  submitting,
  changingLanguage,
  connectionState,
  subtitles,
  audioState,
  audioBlocked,
  muted,
  playAudio,
  toggleMute,
  leave,
  changeLanguage,
} = useRoomSession()
</script>

<template>
  <template v-if="configuration && active && session">
    <div class="room-layout">
      <ListenerPanel
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
      :room-number="roomNumber"
      :session="session"
      :credential="credential"
    />
  </template>
  <section v-else-if="restoring" class="entry-panel" aria-busy="true" role="status">
    <p>{{ t('restoring') }}</p>
  </section>
</template>
