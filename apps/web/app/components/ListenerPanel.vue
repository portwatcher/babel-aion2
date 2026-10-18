<script setup lang="ts">
import type { ListenerSnapshot, PublicRoomConfiguration } from '@babel/contracts'
import { audioStatus } from '~/utils/audio-status'
import type { SubtitlePresentation } from '~/utils/subtitle-view'
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
const textSizes = [
  { label: '标准', value: 1.25 },
  { label: '大', value: 1.5 },
  { label: '特大', value: 2 },
]
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
        :value="connectionState === 'connected' ? '已进入房间' : '正在恢复连接'"
        severity="secondary"
      />
    </div>
    <p v-if="session.state === 'JOINING'" role="status">正在等待收听通道就绪。</p>
    <p v-else role="status">会话已连接。</p>
    <p class="muted">{{ audioStatus[configuration.room.audioState].description }}</p>
    <p v-if="session.state === 'ACTIVE'" role="status">
      {{
        audioState === 'connected'
          ? '原声通道已连接，等待指挥音频。'
          : audioState === 'unavailable'
            ? '原声通道暂不可用。'
            : '正在连接原声通道。'
      }}
    </p>
    <Button
      v-if="audioBlocked"
      label="播放原声"
      severity="secondary"
      @click="emit('playAudio')"
    />
    <Button
      v-if="audioState === 'connected'"
      :label="muted ? '取消静音' : '静音'"
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
      <label for="subtitle-text-size">字幕字号</label>
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
        :label="target ? '关闭字幕小窗' : '打开字幕小窗'"
        severity="secondary"
        :loading="opening"
        aria-describedby="pip-notice"
        @click="target ? pip.close() : pip.open()"
      />
      <small id="pip-notice" class="muted">
        小窗与本页同步。窗口大小由浏览器控制；全屏游戏中的显示效果需实际确认。
      </small>
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
      label="退出房间"
      severity="secondary"
      :loading="busy"
      @click="emit('leave')"
    />
  </section>
</template>
