<script setup lang="ts">
import { COMPUTER_AUDIO, type useHostCapture } from '~/composables/useHostCapture'
const { t } = useInterfaceLocale()
const props = defineProps<{ capture: ReturnType<typeof useHostCapture> }>()
const { state, muted, selected, devices } = props.capture
const computerAudioSupported = ref(false)
onMounted(() => {
  computerAudioSupported.value =
    typeof navigator.mediaDevices?.getDisplayMedia === 'function'
})
const options = computed(() => [
  ...(computerAudioSupported.value
    ? [{ value: COMPUTER_AUDIO, label: t('computerAudio') }]
    : []),
  ...devices.value.map((device) => ({
    value: device.value,
    label: device.label || t('defaultInput'),
  })),
])
function choose(value: string | null) {
  if (value) {
    void props.capture.select(value)
  }
}
</script>

<template>
  <div class="field host-capture">
    <label for="host-input">{{ t('audioInput') }}</label>
    <div class="host-capture-controls">
      <Select
        input-id="host-input"
        :model-value="selected"
        :options="options"
        option-label="label"
        option-value="value"
        :placeholder="t('chooseAudioInput')"
        aria-describedby="host-input-help"
        @update:model-value="choose"
      />
      <Button
        v-if="state === 'live'"
        :label="muted ? t('unmute') : t('mute')"
        severity="secondary"
        :aria-pressed="muted"
        @click="capture.toggleMute"
      />
      <Button
        v-else-if="selected"
        :label="t('retryCapture')"
        severity="secondary"
        @click="choose(selected)"
      />
    </div>
    <small v-if="selected === COMPUTER_AUDIO" id="host-input-help" class="muted">{{
      t('computerAudioHelp')
    }}</small>
  </div>
</template>
