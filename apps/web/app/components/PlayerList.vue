<script setup lang="ts">
import type { PublicListener } from '@babel/contracts'
const { t, locale } = useInterfaceLocale()
defineProps<{ players: PublicListener[]; current: boolean }>()
const states = computed(() => ({
  JOINING: t('listenerJoining'),
  ACTIVE: t('listenerActive'),
  DISCONNECTING: t('listenerDisconnecting'),
}))
function time(value: string) {
  return new Date(value).toLocaleTimeString(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <section class="room-detail" aria-labelledby="players-title">
    <div class="section-heading">
      <h2 id="players-title">{{ t('playersTitle') }}</h2>
      <span class="muted">{{
        current ? t('connectionCount', { count: players.length }) : t('updating')
      }}</span>
    </div>
    <p v-if="current && !players.length" class="muted">{{ t('playersEmpty') }}</p>
    <ul v-if="players.length" class="player-list">
      <li v-for="player in players" :key="player.sessionId">
        <div class="player-identity">
          <strong>{{ player.nickname }}</strong
          ><time :datetime="player.joinedAt" class="muted">{{
            t('joinedAt', { time: time(player.joinedAt) })
          }}</time>
        </div>
        <div class="player-actions">
          <Tag
            :value="states[player.state]"
            :severity="player.state === 'ACTIVE' ? 'success' : 'secondary'"
          />
          <slot name="actions" :player="player" />
        </div>
      </li>
    </ul>
    <p v-if="!current" class="muted" role="status">{{ t('playersUnavailable') }}</p>
  </section>
</template>
