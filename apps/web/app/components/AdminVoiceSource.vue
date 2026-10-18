<script setup lang="ts">
import { voiceSourceStatusSchema, type VoiceSourceStatus } from '@babel/contracts'
import { audioStatus } from '~/utils/audio-status'

const source = shallowRef<VoiceSourceStatus | null>(null)
const unavailable = ref(false)
let checking = false
let disposed = false
let timer: ReturnType<typeof setInterval> | undefined
const reason = computed(() => {
  switch (source.value?.reason) {
    case 'CONFIGURATION':
      return '请检查来源设置和 worker 的凭据保护配置。'
    case 'OWNERSHIP':
      return '另一个 worker 或尚未确认关闭的旧来源占有此机器人。'
    case 'STORAGE':
      return '来源存储暂不可用，音频已停止。'
    case 'DISCORD':
      return 'Discord 连接暂不可用，正在重试。'
    default:
      return ''
  }
})
async function load() {
  if (checking) {
    return
  }
  checking = true
  try {
    const next = voiceSourceStatusSchema.parse(
      await $fetch('/api/management/room/source'),
    )
    if (!disposed) {
      source.value = next
      unavailable.value = false
    }
  } catch {
    if (!disposed) {
      unavailable.value = true
      source.value = null
    }
  } finally {
    checking = false
  }
}
onMounted(() => {
  void load()
  timer = setInterval(() => void load(), 3_000)
})
onBeforeUnmount(() => {
  disposed = true
  clearInterval(timer)
})
</script>

<template>
  <div class="field" aria-live="polite">
    <p v-if="unavailable" class="muted">暂时无法连接语音 worker。</p>
    <template v-else-if="source">
      <p>{{ audioStatus[source.state].description }}</p>
      <p v-if="reason" class="muted">{{ reason }}</p>
      <ul v-if="source.speakers.length" aria-label="已接收的频道音源">
        <li v-for="speaker in source.speakers" :key="speaker.id">
          {{ speaker.displayName }} · {{ speaker.id }} · 已解码
          {{ speaker.receivedFrames }} 帧
        </li>
      </ul>
    </template>
  </div>
</template>
