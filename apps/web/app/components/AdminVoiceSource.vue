<script setup lang="ts">
const { t } = useInterfaceLocale()
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
      return 'Check source settings and worker credential protection.'
    case 'OWNERSHIP':
      return 'Another worker or a previous source awaiting confirmed shutdown owns this bot.'
    case 'STORAGE':
      return 'Source storage unavailable. Audio has stopped.'
    case 'DISCORD':
      return 'Discord connection unavailable. Retrying.'
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
    <p v-if="unavailable" class="muted">Voice worker temporarily unreachable.</p>
    <template v-else-if="source">
      <p>{{ t(audioStatus[source.state].description) }}</p>
      <p v-if="reason" class="muted">{{ reason }}</p>
      <ul v-if="source.speakers.length" aria-label="Received channel audio sources">
        <li v-for="speaker in source.speakers" :key="speaker.id">
          {{ speaker.displayName }} · {{ speaker.id }} · Decoded
          {{ speaker.receivedFrames }} frames
        </li>
      </ul>
    </template>
  </div>
</template>
