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
  subtitles,
  audioState,
  audioBlocked,
  muted,
  playAudio,
  toggleMute,
  microphone,
  microphoneMuted,
  toggleMicrophone,
  reconnectAudio,
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
        :microphone="microphone"
        :microphone-muted="microphoneMuted"
        :busy="submitting"
        :changing-language="changingLanguage"
        @leave="leave"
        @close-room="closeRoom"
        @language="changeLanguage"
        @play-audio="playAudio"
        @toggle-mute="toggleMute"
        @toggle-microphone="toggleMicrophone"
        @reconnect-audio="reconnectAudio"
      />
      <PlayerList :players="players" :current="playersCurrent" />
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
