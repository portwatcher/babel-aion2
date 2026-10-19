<script setup lang="ts">
import type { ListenerSnapshot, PublicRoomConfiguration } from '@babel/contracts'
import { audioStatus } from '~/utils/audio-status'
import type { SubtitlePresentation } from '~/utils/subtitle-view'
const { t } = useInterfaceLocale()
const props = defineProps<{
  session: ListenerSnapshot
  configuration: PublicRoomConfiguration
  connectionState: string
  audioState: string
  audioBlocked: boolean
  muted: boolean
  busy: boolean
  changingLanguage: boolean
  subtitles: SubtitlePresentation
}>()
const emit = defineEmits<{
  leave: []
  language: [language: string | null]
  playAudio: []
  toggleMute: []
}>()
const pip = useSubtitlePictureInPicture(
  () => `${props.session.sessionId}:${props.session.nicknameGeneration}`,
)
const { supported, opening, target, error: pipError } = pip
const textSize = ref(1.25)
const textSizes = computed(() => [
  { label: t('textStandard'), value: 1.25 },
  { label: t('textLarge'), value: 1.5 },
  { label: t('textExtraLarge'), value: 2 },
])
const status = computed(() => {
  if (props.session.state === 'JOINING') {
    return t('waitingChannel')
  }
  const roomState = props.configuration.room.audioState
  if (roomState !== 'LISTENING') {
    return t(audioStatus[roomState].description)
  }
  if (props.audioState === 'connected') {
    return t('audioConnected')
  }
  return props.audioState === 'unavailable'
    ? t('audioUnavailable')
    : t('audioConnecting')
})
const languageName = computed(
  () =>
    props.configuration.outputLanguages.find(
      (language) => language.code === props.session.outputLanguage,
    )?.name ?? null,
)
</script>

<template>
  <section class="entry-panel listener-panel" aria-labelledby="listener-title">
    <div class="listener-header">
      <div class="listener-identity">
        <h2 id="listener-title">{{ session.nickname }}</h2>
        <p class="muted" role="status">
          <Tag
            v-if="connectionState !== 'connected'"
            :value="t('reconnecting')"
            severity="warn"
          />
          {{ status }}
        </p>
      </div>
      <div class="listener-audio">
        <Button
          v-if="audioBlocked"
          :label="t('playAudio')"
          @click="emit('playAudio')"
        />
        <Button
          v-if="audioState === 'connected'"
          :label="muted ? t('unmute') : t('mute')"
          severity="secondary"
          :aria-pressed="muted"
          @click="emit('toggleMute')"
        />
      </div>
    </div>
    <ListenerSubtitleStatus
      :session="session"
      :connection-state="connectionState"
      :language-name="languageName"
      :changing-language="changingLanguage"
      :text-size="textSize"
      :subtitles="subtitles"
    />
    <div class="listener-settings">
      <OutputLanguageSelect
        :model-value="session.outputLanguage"
        :languages="configuration.outputLanguages"
        :disabled="changingLanguage"
        @update:model-value="emit('language', $event)"
      />
      <div class="field">
        <label for="subtitle-text-size">{{ t('subtitleTextSize') }}</label>
        <Select
          v-model="textSize"
          input-id="subtitle-text-size"
          :options="textSizes"
          option-label="label"
          option-value="value"
        />
      </div>
    </div>
    <p v-if="pipError" class="form-error" role="alert">{{ pipError }}</p>
    <div class="listener-actions">
      <Button
        v-if="supported"
        :label="target ? t('closePip') : t('openPip')"
        severity="secondary"
        :loading="opening"
        @click="target ? pip.close() : pip.open()"
      />
      <Button
        :label="t('leaveRoom')"
        severity="secondary"
        variant="outlined"
        :loading="busy"
        @click="emit('leave')"
      />
    </div>
    <Teleport v-if="target" :to="target">
      <ListenerSubtitleStatus
        :session="session"
        :connection-state="connectionState"
        :language-name="languageName"
        :changing-language="changingLanguage"
        :text-size="textSize"
        :subtitles="subtitles"
        compact
      />
    </Teleport>
  </section>
</template>
