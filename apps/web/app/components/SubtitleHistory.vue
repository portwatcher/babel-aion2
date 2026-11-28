<script setup lang="ts">
import type { ListenerSnapshot } from '@babel/contracts'
import type { SubtitleHistoryState } from '~/composables/useSubtitleHistory'

const { t, locale } = useInterfaceLocale()
const props = defineProps<{
  session: ListenerSnapshot
  languageName: string | null
  changingLanguage: boolean
  history: SubtitleHistoryState
}>()
const emit = defineEmits<{ retry: [] }>()

const scroller = ref<HTMLElement | null>(null)
const pinned = ref(true)

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function handleScroll() {
  const element = scroller.value
  if (!element) {
    return
  }
  pinned.value = element.scrollHeight - element.scrollTop - element.clientHeight <= 48
}

function scrollToBottom() {
  const element = scroller.value
  if (!element) {
    return
  }
  element.scrollTop = element.scrollHeight
}

watch(
  () => `${props.session.outputLanguage ?? ''}:${props.session.subscriptionVersion}`,
  () => {
    pinned.value = true
  },
)

watch(
  () => props.history.items,
  (items) => {
    if (!items.length || !pinned.value) {
      return
    }
    void nextTick(scrollToBottom)
  },
  { immediate: true },
)

const contextLabel = computed(() =>
  props.languageName
    ? `${props.languageName} · ${t('subtitleHistoryWindow')}`
    : t('subtitleHistoryWindow'),
)
</script>

<template>
  <section class="subtitle-history" aria-labelledby="subtitle-history-title">
    <div class="section-heading subtitle-history-header">
      <h3 id="subtitle-history-title">{{ t('subtitleHistoryTitle') }}</h3>
      <span class="subtitle-history-meta muted">{{ contextLabel }}</span>
    </div>
    <p v-if="!session.outputLanguage" class="muted">
      {{ t('subtitlesDisabled') }}
    </p>
    <p v-else-if="session.state === 'JOINING'" class="muted" role="status">
      {{ t('waitingChannel') }}
    </p>
    <p
      v-else-if="changingLanguage || (history.loading && !history.items.length)"
      class="muted"
      role="status"
      aria-busy="true"
    >
      {{ t('subtitleHistoryLoading') }}
    </p>
    <div
      v-else-if="history.error && !history.items.length"
      class="subtitle-history-feedback"
      role="alert"
    >
      <p class="form-error">{{ t('subtitleHistoryUnavailable') }}</p>
      <Button :label="t('reload')" severity="secondary" @click="emit('retry')" />
    </div>
    <div v-else-if="!history.items.length" class="subtitle-history-empty" role="status">
      <p class="muted">{{ t('subtitleHistoryEmpty') }}</p>
      <small class="muted">{{ t('subtitleHistoryEmptyHelp') }}</small>
    </div>
    <template v-else>
      <div v-if="history.error" class="subtitle-history-feedback" role="alert">
        <p class="form-error">{{ t('subtitleHistoryUnavailable') }}</p>
        <Button :label="t('reload')" severity="secondary" @click="emit('retry')" />
      </div>
      <div
        ref="scroller"
        class="subtitle-history-scroll"
        tabindex="0"
        role="region"
        :aria-label="t('subtitleHistoryTitle')"
        @scroll="handleScroll"
      >
        <ol class="subtitle-history-list">
          <li
            v-for="item in history.items"
            :key="item.utteranceId"
            class="subtitle-history-item"
          >
            <div class="subtitle-history-item-meta muted">
              <span class="subtitle-history-speaker">{{
                item.speakerDisplayName
              }}</span>
              <time :datetime="item.recordedAt" class="subtitle-history-time">{{
                formatTime(item.recordedAt)
              }}</time>
              <span v-if="!item.translationIsFinal" class="subtitle-history-live">{{
                t('subtitleInterim')
              }}</span>
            </div>
            <p class="subtitle-history-translated" :lang="item.outputLanguage">
              {{ item.translatedText }}
            </p>
            <p
              v-if="
                item.originalText.trim() &&
                item.originalText.trim() !== item.translatedText.trim()
              "
              class="subtitle-history-original"
            >
              <span class="subtitle-original-label">{{
                t(item.sourceIsFinal ? 'sourceFinal' : 'sourceInterim')
              }}</span>
              <span :lang="item.sourceLanguage" dir="auto">{{
                item.originalText
              }}</span>
            </p>
          </li>
        </ol>
      </div>
    </template>
  </section>
</template>
