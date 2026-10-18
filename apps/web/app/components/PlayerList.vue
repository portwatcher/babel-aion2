<script setup lang="ts">
import type { PublicListener } from '@babel/contracts'
defineProps<{ players: PublicListener[]; current: boolean }>()
const states = { JOINING: '等待收听', ACTIVE: '已连接', DISCONNECTING: '正在断开' }
function time(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <section class="room-detail" aria-labelledby="players-title">
    <div class="section-heading">
      <h2 id="players-title">在线名单</h2>
      <span class="muted">{{ current ? `${players.length} 个连接` : '正在更新' }}</span>
    </div>
    <p class="muted">名单显示连接状态，不代表玩家正在听见声音。</p>
    <p v-if="current && !players.length" class="muted">当前没有收听连接。</p>
    <ul v-if="players.length" class="player-list">
      <li v-for="player in players" :key="player.sessionId">
        <div class="player-identity">
          <strong>{{ player.nickname }}</strong
          ><time :datetime="player.joinedAt" class="muted"
            >{{ time(player.joinedAt) }} 进入</time
          >
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
    <p v-if="!current" class="muted" role="status">
      暂时无法更新名单，连接恢复后会自动重试。
    </p>
  </section>
</template>
