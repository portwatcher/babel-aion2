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
const languageName = computed(
  () =>
    props.configuration.outputLanguages.find(
      (language) => language.code === props.session.outputLanguage,
    )?.name ?? null,
)
</script>

<template>
  <section class="entry-panel listener-panel" aria-labelledby="listener-title">
    <div class="section-heading">
      <h2 id="listener-title">{{ session.nickname }}</h2>
      <Tag
        :value="connectionState === 'connected' ? t('joined') : t('reconnecting')"
        severity="secondary"
      />
    </div>
    <p v-if="session.state === 'JOINING'" role="status">{{ t('waitingChannel') }}</p>
    <p v-else role="status">{{ t('sessionConnected') }}</p>
    <p class="muted">{{ t(audioStatus[configuration.room.audioState].description) }}</p>
    <p v-if="session.state === 'ACTIVE'" role="status">
      {{
        audioState === 'connected'
          ? t('audioConnected')
          : audioState === 'unavailable'
            ? t('audioUnavailable')
            : t('audioConnecting')
      }}
    </p>
    <Button
      v-if="audioBlocked"
      :label="t('playAudio')"
      severity="secondary"
      @click="emit('playAudio')"
    />
    <Button
      v-if="audioState === 'connected'"
      :label="muted ? t('unmute') : t('mute')"
      severity="secondary"
      :aria-pressed="muted"
      @click="emit('toggleMute')"
    />
    <OutputLanguageSelect
      :model-value="session.outputLanguage"
      :languages="configuration.outputLanguages"
      :disabled="changingLanguage"
      @update:model-value="emit('language', $event)"
    />
    <ListenerSubtitleStatus
      :session="session"
      :connection-state="connectionState"
      :language-name="languageName"
      :changing-language="changingLanguage"
      :text-size="textSize"
      :subtitles="subtitles"
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
    <div v-if="supported" class="field">
      <Button
        :label="target ? t('closePip') : t('openPip')"
        severity="secondary"
        :loading="opening"
        aria-describedby="pip-notice"
        @click="target ? pip.close() : pip.open()"
      />
      <small id="pip-notice" class="muted">{{ t('pipNotice') }}</small>
      <p v-if="pipError" class="form-error" role="alert">{{ pipError }}</p>
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
    <Button
      :label="t('leaveRoom')"
      severity="secondary"
      :loading="busy"
      @click="emit('leave')"
    />
  </section>
</template>
