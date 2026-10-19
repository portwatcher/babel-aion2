<script setup lang="ts">
import type { ListenerSnapshot } from '@babel/contracts'
import type { SubtitlePresentation } from '~/utils/subtitle-view'

const props = defineProps<{
  session: ListenerSnapshot
  connectionState: string
  languageName: string | null
  changingLanguage: boolean
  compact?: boolean
  textSize: number
  subtitles: SubtitlePresentation
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
  if (props.subtitles.state === 'UNAVAILABLE') {
    return props.subtitles.failure === 'QUOTA_EXHAUSTED'
      ? '当前字幕服务额度已用尽。原声继续播放。'
      : '当前字幕服务暂不可用，正在恢复。原声继续播放。'
  }
  if (props.subtitles.state === 'STOPPED') {
    return '语音来源已停止。'
  }
  if (props.subtitles.state === 'CONNECTING') {
    return '正在连接当前语言的字幕服务…'
  }
  return '等待指挥字幕…'
})
const visible = computed(() =>
  props.connectionState === 'connected' &&
  !props.changingLanguage &&
  props.session.state === 'ACTIVE'
    ? props.subtitles.items.slice(0, props.compact ? 1 : 2)
    : [],
)
</script>

<template>
  <section
    :class="['listener-subtitles', { 'listener-subtitles-compact': compact }]"
    :style="{ '--subtitle-text-size': `${textSize}rem` }"
    aria-label="当前指挥字幕"
  >
    <p v-if="compact" class="subtitle-context muted">
      {{ languageName ?? '指挥字幕' }}
    </p>
    <div
      v-for="subtitle in visible"
      :key="subtitle.speakerId"
      class="subtitle-command"
      aria-live="polite"
      aria-atomic="true"
    >
      <small class="subtitle-context muted"
        >{{ subtitle.speakerDisplayName }} ·
        {{ subtitle.translationIsFinal ? '稳定字幕' : '临时字幕' }}</small
      >
      <p class="subtitle-message" :lang="subtitle.outputLanguage">
        {{
          subtitle.translatedText || (subtitle.failure ? '翻译暂不可用' : '正在翻译…')
        }}
      </p>
      <details v-if="!compact">
        <summary>
          {{
            subtitle.sourceAlignment === 'independent'
              ? '当前原文流（独立识别）'
              : '原文'
          }}{{ subtitle.sourceIsFinal ? '' : '（识别中）' }}
        </summary>
        <p :lang="subtitle.sourceLanguage">{{ subtitle.originalText }}</p>
      </details>
      <small v-if="!compact && subtitle.discontinuity" class="muted"
        >部分过期内容已丢弃，已回到当前语音。</small
      >
    </div>
    <p
      v-if="!visible.length || subtitles.state === 'UNAVAILABLE'"
      class="subtitle-message"
      role="status"
    >
      {{ message }}
    </p>
    <small v-if="!compact && !session.outputLanguage" class="muted">
      管理员配置识别与翻译后，指挥字幕会显示在这里。
    </small>
  </section>
</template>
