<script setup lang="ts">
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
  mapRevision,
  subtitles,
  audioState,
  audioBlocked,
  muted,
  playAudio,
  toggleMute,
  capture,
  leave,
  closeRoom,
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
        :capture="capture"
        :busy="submitting"
        :changing-language="changingLanguage"
        @leave="leave"
        @close-room="closeRoom"
        @language="changeLanguage"
        @play-audio="playAudio"
        @toggle-mute="toggleMute"
      />
      <PlayerList :players="players" :current="playersCurrent" />
    </div>
    <TacticalMap
      :room-number="roomNumber"
      :session="session"
      :credential="credential"
      :revision="mapRevision"
    />
  </template>
  <section v-else-if="restoring" class="entry-panel" aria-busy="true" role="status">
    <p>{{ t('restoring') }}</p>
  </section>
</template>
