<script setup lang="ts">
import type { ListenerSnapshot } from '@babel/contracts'
import type { SubtitlePresentation } from '~/utils/subtitle-view'

const { t } = useInterfaceLocale()
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
    return t('subtitleReconnecting')
  }
  if (props.changingLanguage) {
    return t('subtitleChanging')
  }
  if (!props.session.outputLanguage) {
    return t('subtitlesDisabled')
  }
  if (props.session.state === 'JOINING') {
    return t('waitingChannel')
  }
  if (props.subtitles.state === 'UNAVAILABLE') {
    return props.subtitles.failure === 'QUOTA_EXHAUSTED'
      ? t('subtitleQuota')
      : t('subtitleUnavailable')
  }
  if (props.subtitles.state === 'STOPPED') {
    return t('subtitleSourceStopped')
  }
  if (props.subtitles.state === 'CONNECTING') {
    return t('subtitleConnecting')
  }
  return t('subtitleWaiting')
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
    :aria-label="t('currentSubtitles')"
  >
    <p v-if="compact" class="subtitle-context muted">
      {{ languageName ?? t('commanderSubtitles') }}
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
        {{
          subtitle.translationIsFinal ? t('subtitleFinal') : t('subtitleInterim')
        }}</small
      >
      <p class="subtitle-message" :lang="subtitle.outputLanguage">
        {{
          subtitle.translatedText ||
          (subtitle.failure ? t('translationUnavailable') : t('translating'))
        }}
      </p>
      <details v-if="!compact" :open="!subtitle.translatedText">
        <summary>
          {{
            subtitle.sourceAlignment === 'independent'
              ? t('sourceIndependent')
              : t(subtitle.sourceIsFinal ? 'sourceFinal' : 'sourceInterim')
          }}
        </summary>
        <p :lang="subtitle.sourceLanguage">{{ subtitle.originalText }}</p>
        <small v-if="!subtitle.translatedText" class="muted">{{
          t('translationMaySkipSource')
        }}</small>
      </details>
      <small v-if="!compact && subtitle.discontinuity" class="muted">{{
        t('subtitleDiscontinuity')
      }}</small>
    </div>
    <p
      v-if="!visible.length || subtitles.state === 'UNAVAILABLE'"
      class="subtitle-message"
      role="status"
    >
      {{ message }}
    </p>
    <small v-if="!compact && !session.outputLanguage" class="muted">{{
      t('subtitleSetup')
    }}</small>
  </section>
</template>
