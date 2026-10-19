<script setup lang="ts">
const { t } = useInterfaceLocale()
const {
  roomId,
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
      <PlayerList :players="players" :current="playersCurrent" />
    </div>
    <TacticalMap :room-id="roomId" :session="session" :credential="credential" />
  </template>
  <section v-else-if="restoring" class="entry-panel" aria-busy="true" role="status">
    <p>{{ t('restoring') }}</p>
  </section>
</template>
