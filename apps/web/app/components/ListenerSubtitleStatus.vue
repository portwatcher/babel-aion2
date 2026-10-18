<script setup lang="ts">
import type { ListenerSnapshot } from '@babel/contracts'

const props = defineProps<{
  session: ListenerSnapshot
  connectionState: string
  languageName: string | null
  changingLanguage: boolean
  compact?: boolean
  textSize: number
}>()

const message = computed(() => {
  if (props.connectionState !== 'connected') {
    return '连接正在恢复，暂时无法更新字幕。'
  }
  if (props.changingLanguage) {
    return '正在切换字幕语言…'
  }
  if (!props.session.outputLanguage) {
    return '字幕尚未启用'
  }
  if (props.session.state === 'JOINING') {
    return '正在等待收听通道就绪。'
  }
  return '等待指挥字幕…'
})
</script>

<template>
  <section
    :class="['listener-subtitles', { 'listener-subtitles-compact': compact }]"
    :style="{ '--subtitle-text-size': `${textSize}rem` }"
    aria-label="当前字幕状态"
  >
    <p v-if="compact" class="subtitle-context muted">
      {{ languageName ?? '指挥字幕' }}
    </p>
    <p class="subtitle-message" role="status">{{ message }}</p>
    <small v-if="!compact && !session.outputLanguage" class="muted">
      管理员配置识别与翻译后，指挥字幕会显示在这里。
    </small>
  </section>
</template>
