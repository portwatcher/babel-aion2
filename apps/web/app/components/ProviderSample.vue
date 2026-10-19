<script setup lang="ts">
import {
  providerSampleResultSchema,
  languageSampleResultSchema,
  type ManagedLanguage,
  type ProviderSampleResult,
  type ProviderSummary,
} from '@babel/contracts'
import { providerFailure, providerTestLabel } from '~/utils/provider-feedback'
import { languageFailure } from '~/utils/language-feedback'

const props = defineProps<{
  providers: ProviderSummary[]
  disabled: boolean
  terminologyVersion: number | null
  path?: ManagedLanguage | null
}>()
const emit = defineEmits<{
  busy: [value: boolean]
  validated: [value: ManagedLanguage]
}>()
const formId = useId()
const recognitionId = computed(() => props.providers[0]?.id ?? null)
const translationId = recognitionId
const outputLanguage = ref('')
const includeTerms = ref(true)
const effectiveRecognition = computed(
  () => props.path?.recognitionConfigurationId ?? recognitionId.value,
)
const effectiveTranslation = computed(
  () => props.path?.translationConfigurationId ?? translationId.value,
)
const audio = shallowRef<File | null>(null)
const previewUrl = ref('')
const running = ref(false)
const error = ref('')
const result = shallowRef<ProviderSampleResult | null>(null)
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
watch(
  [
    recognitionId,
    translationId,
    outputLanguage,
    includeTerms,
    () => props.providers,
    () => props.terminologyVersion,
    () => props.path?.code,
    () => props.path?.pathVersion,
  ],
  () => {
    result.value = null
    error.value = ''
  },
)
async function preview() {
  if (running.value || props.disabled) {
    return
  }
  const recognition = props.providers.find(
    (value) => value.id === effectiveRecognition.value,
  )
  const translation = props.providers.find(
    (value) => value.id === effectiveTranslation.value,
  )
  if (!recognition || !translation || !audio.value || audio.value.size > 1_000_000) {
    error.value = '请先保存 API Key，并选择不超过 1 MB 的音频样本。'
    return
  }
  let code: string
  try {
    code = props.path?.code ?? new Intl.Locale(outputLanguage.value.trim()).baseName
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
    let response: ProviderSampleResult
    if (props.path) {
      const validation = languageSampleResultSchema.parse(
        await $fetch<unknown, string>(
          `/api/management/languages/${props.path.code}/validate`,
          {
            method: 'POST',
            body: { expectedVersion: props.path.version, audioBase64: btoa(binary) },
          },
        ),
      )
      response = validation.sample
      if (!disposed) {
        emit('validated', validation.language)
      }
    } else {
      response = providerSampleResultSchema.parse(
        await $fetch<unknown, string>('/api/management/providers/sample', {
          method: 'POST',
          body: {
            recognition: { id: recognition.id, version: recognition.version },
            translation: { id: translation.id, version: translation.version },
            outputLanguage: code,
            includeTerms: includeTerms.value,
            audioBase64: btoa(binary),
          },
        }),
      )
    }
    if (!disposed) {
      result.value = response
    }
  } catch (failure) {
    if (!disposed) {
      error.value = props.path ? languageFailure(failure) : providerFailure(failure)
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
    <h3>{{ path ? `验证样本路径：${path.name}` : '音频样本测试' }}</h3>
    <p class="muted">
      使用已保存的 OpenAI API
      Key处理一段授权样本，核对原文与译文。测试文字仅在此页展示，不会启用语言或发送给玩家。
    </p>
    <p v-if="path" class="muted">
      输出 {{ path.code }} ·
      {{
        path.includeTerms ? '使用游戏术语提示' : '不使用游戏术语提示'
      }}。验证状态会保存到此语言配置。
    </p>
    <p class="muted">
      音频会同时发送至 OpenAI
      识别和目标语言翻译会话，并产生服务费用。请选择获授权的样本；服务器不保存音频或测试文字。
      处理期间会持续识别和翻译，结果在结束后显示。
    </p>
    <div v-if="!path" class="field">
      <label :for="`${formId}-language`">样本输出语言代码</label>
      <InputText
        :id="`${formId}-language`"
        v-model="outputLanguage"
        :disabled="disabled || running"
        maxlength="35"
        placeholder="例如 zh-Hans、ja、ko"
        required
      />
    </div>
    <div class="field">
      <label :for="`${formId}-audio`">授权音频样本</label>
      <input
        :id="`${formId}-audio`"
        type="file"
        accept=".wav,audio/wav"
        :disabled="disabled || running"
        :aria-describedby="`${formId}-format`"
        required
        @change="selectAudio"
      />
      <small :id="`${formId}-format`" class="muted"
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
    <div v-if="!path" class="check-field">
      <Checkbox
        :input-id="`${formId}-terms`"
        v-model="includeTerms"
        binary
        :disabled="disabled || running"
      />
      <label :for="`${formId}-terms`">使用已启用的游戏术语提示</label>
    </div>
    <small v-if="!path" class="muted"
      >启用后，词表仅用于识别提示，实时翻译不支持自定义词表。可关闭此项对比效果。<a
        href="#terms-title"
        >管理术语表</a
      ></small
    >
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="management-actions">
      <Button
        type="submit"
        label="识别并翻译样本"
        :loading="running"
        :disabled="disabled || !effectiveRecognition || !effectiveTranslation || !audio"
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
      <p v-if="result.terminology" class="muted">
        词表版本 {{ result.terminology.version }} · 识别术语提示
        {{ result.terminology.recognitionTermCount }} 项
      </p>
      <p v-else class="muted">本次未使用术语提示。</p>
      <ol class="sample-segments">
        <li v-for="segment in result.segments" :key="segment.utteranceId">
          <p class="muted">
            {{ segment.sourceAlignment === 'independent' ? '独立原文流' : '原文' }} ·
            {{ segment.isFinal ? '已完成识别' : '识别中' }} ·
            {{ segment.language === 'und' ? '语言未识别' : segment.language }}
          </p>
          <p>{{ segment.text || '原文已撤回' }}</p>
          <p class="muted">
            {{ segment.translationIsFinal ? '稳定译文' : '未稳定译文' }}
          </p>
          <p>
            {{
              segment.failure
                ? providerTestLabel(segment.failure)
                : segment.translatedText || '暂无译文'
            }}
          </p>
          <small class="muted"
            >译文术语上下文 {{ segment.translationTermCount }} 项 ·
            服务报告的样本时间：{{ segment.audioStartMs ?? '未知' }}–{{
              segment.audioEndMs ?? '未知'
            }}
            ms</small
          >
        </li>
      </ol>
    </div>
  </form>
</template>
