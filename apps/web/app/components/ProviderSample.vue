<script setup lang="ts">
import {
  providerSampleResultSchema,
  type ProviderSampleResult,
  type ProviderSummary,
} from '@babel/contracts'
import { providerFailure, providerTestLabel } from '~/utils/provider-feedback'

const props = defineProps<{ providers: ProviderSummary[]; disabled: boolean }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const recognitionId = ref<string | null>(null)
const translationId = ref<string | null>(null)
const outputLanguage = ref('')
const audio = shallowRef<File | null>(null)
const previewUrl = ref('')
const running = ref(false)
const error = ref('')
const result = shallowRef<ProviderSampleResult | null>(null)
const recognitionOptions = computed(() =>
  props.providers.filter((value) => value.settings.type === 'soniox'),
)
const translationOptions = computed(() =>
  props.providers.filter((value) => value.settings.type === 'deepl'),
)
let disposed = false

function selectAudio(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) {
    return
  }
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
  audio.value = target.files?.[0] ?? null
  previewUrl.value = audio.value ? URL.createObjectURL(audio.value) : ''
  result.value = null
  error.value = ''
}
watch([recognitionId, translationId, outputLanguage, () => props.providers], () => {
  result.value = null
  error.value = ''
})
async function preview() {
  if (running.value || props.disabled) {
    return
  }
  const recognition = props.providers.find((value) => value.id === recognitionId.value)
  const translation = props.providers.find((value) => value.id === translationId.value)
  if (!recognition || !translation || !audio.value || audio.value.size > 1_000_000) {
    error.value = '请选择识别、翻译配置和不超过 1 MB 的音频样本。'
    return
  }
  let code: string
  try {
    code = new Intl.Locale(outputLanguage.value.trim()).baseName
  } catch {
    error.value = '请输入有效的输出语言代码，例如 zh-Hans、ja 或 ko。'
    return
  }
  running.value = true
  emit('busy', true)
  result.value = null
  error.value = ''
  try {
    const bytes = new Uint8Array(await audio.value.arrayBuffer())
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
    }
    const response = providerSampleResultSchema.parse(
      await $fetch<unknown, string>('/api/management/providers/sample', {
        method: 'POST',
        body: {
          recognition: { id: recognition.id, version: recognition.version },
          translation: { id: translation.id, version: translation.version },
          outputLanguage: code,
          audioBase64: btoa(binary),
        },
      }),
    )
    if (!disposed) {
      result.value = response
    }
  } catch (failure) {
    if (!disposed) {
      error.value = providerFailure(failure)
    }
  } finally {
    running.value = false
    emit('busy', false)
  }
}
onBeforeUnmount(() => {
  disposed = true
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
})
</script>

<template>
  <form class="entry-form provider-editor" @submit.prevent="preview">
    <h3>音频样本测试</h3>
    <p class="muted">
      使用已保存的识别与翻译配置处理一段授权样本，核对原文与译文。结果仅在此页展示，不会启用语言或发送给玩家。
    </p>
    <p class="muted">
      音频会发送至 Soniox，识别文字会发送至
      DeepL，可能产生服务费用。请选择获授权的样本；服务器不保存音频或测试文字。
    </p>
    <div class="field">
      <label for="sample-recognition">语音识别配置</label>
      <Select
        input-id="sample-recognition"
        v-model="recognitionId"
        :options="recognitionOptions"
        option-label="name"
        option-value="id"
        :disabled="disabled || running"
        placeholder="选择 Soniox 候选"
      />
    </div>
    <div class="field">
      <label for="sample-translation">文本翻译配置</label>
      <Select
        input-id="sample-translation"
        v-model="translationId"
        :options="translationOptions"
        option-label="name"
        option-value="id"
        :disabled="disabled || running"
        placeholder="选择 DeepL 候选"
      />
    </div>
    <div class="field">
      <label for="sample-language">样本输出语言代码</label>
      <InputText
        id="sample-language"
        v-model="outputLanguage"
        :disabled="disabled || running"
        maxlength="35"
        placeholder="例如 zh-Hans、ja、ko"
        required
      />
    </div>
    <div class="field">
      <label for="sample-audio">授权音频样本</label>
      <input
        id="sample-audio"
        type="file"
        accept=".wav,audio/wav"
        :disabled="disabled || running"
        aria-describedby="sample-format"
        required
        @change="selectAudio"
      />
      <small id="sample-format" class="muted"
        >0.2–10 秒，单声道 16 位 PCM WAV，16 或 48 kHz，最大 1 MB。测试最多等待 30
        秒。</small
      >
      <audio
        v-if="previewUrl"
        :src="previewUrl"
        controls
        preload="metadata"
        aria-label="播放所选音频样本"
      />
    </div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="management-actions">
      <Button
        type="submit"
        label="识别并翻译样本"
        :loading="running"
        :disabled="disabled || !recognitionId || !translationId || !audio"
      />
    </div>
    <div v-if="result" class="sample-result" aria-live="polite">
      <p>
        {{
          result.code === 'PASS'
            ? '样本已处理，请核对识别与翻译是否准确。'
            : result.code === 'NO_SPEECH'
              ? '未识别出可翻译的稳定语音，请检查样本。'
              : providerTestLabel(result.code)
        }}
      </p>
      <small class="muted"
        >输出 {{ result.outputLanguage }} · 识别版本 {{ result.recognitionVersion }} ·
        翻译版本 {{ result.translationVersion }} · 请求耗时
        {{ result.elapsedMs }} ms（不代表实战字幕延迟）</small
      >
      <ol class="sample-segments">
        <li v-for="segment in result.segments" :key="segment.utteranceId">
          <p class="muted">
            {{ segment.isFinal ? '稳定原文' : '未稳定原文' }} ·
            {{ segment.language === 'und' ? '语言未识别' : segment.language }}
          </p>
          <p>{{ segment.text || '原文已撤回' }}</p>
          <p class="muted">译文</p>
          <p>
            {{
              segment.failure
                ? providerTestLabel(segment.failure)
                : segment.translatedText || '暂无译文'
            }}
          </p>
          <small class="muted"
            >服务报告的样本时间：{{ segment.audioStartMs ?? '未知' }}–{{
              segment.audioEndMs ?? '未知'
            }}
            ms</small
          >
        </li>
      </ol>
    </div>
  </form>
</template>
