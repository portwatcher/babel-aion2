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
const recognitionId = ref<string | null>(null)
const translationId = ref<string | null>(null)
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
    error.value =
      'Select recognition and translation configurations and an audio sample no larger than 1 MB.'
    return
  }
  let code: string
  try {
    code = props.path?.code ?? new Intl.Locale(outputLanguage.value.trim()).baseName
  } catch {
    error.value = 'Enter a valid output language code, such as zh-Hans, ja or ko.'
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
    <h3>{{ path ? `Validate sample path: ${path.name}` : 'Audio sample test' }}</h3>
    <p class="muted">
      Process an authorized sample with saved recognition and translation
      configurations, then check the original and translated text. Results stay on this
      page and do not enable languages or reach players.
    </p>
    <p v-if="path" class="muted">
      Output {{ path.code }} ·
      {{
        path.includeTerms ? 'Use game terminology hints' : 'No game terminology hints'
      }}. Validation status is saved to this language configuration.
    </p>
    <p class="muted">
      Audio is sent to Soniox, and recognized text to DeepL. Recognition revisions may
      trigger multiple translations and provider charges. Use authorized samples. The
      server does not save audio or test text. Recognition and translation run
      continuously during processing. Results appear when processing completes.
    </p>
    <div v-if="!path" class="field">
      <label :for="`${formId}-recognition`">Recognition configuration</label>
      <Select
        :input-id="`${formId}-recognition`"
        v-model="recognitionId"
        :options="recognitionOptions"
        option-label="name"
        option-value="id"
        :disabled="disabled || running"
        placeholder="Select Soniox candidate"
      />
    </div>
    <div v-if="!path" class="field">
      <label :for="`${formId}-translation`">Translation configuration</label>
      <Select
        :input-id="`${formId}-translation`"
        v-model="translationId"
        :options="translationOptions"
        option-label="name"
        option-value="id"
        :disabled="disabled || running"
        placeholder="Select DeepL candidate"
      />
    </div>
    <div v-if="!path" class="field">
      <label :for="`${formId}-language`">Sample output language code</label>
      <InputText
        :id="`${formId}-language`"
        v-model="outputLanguage"
        :disabled="disabled || running"
        maxlength="35"
        placeholder="e.g. zh-Hans, ja, ko"
        required
      />
    </div>
    <div class="field">
      <label :for="`${formId}-audio`">Authorized audio sample</label>
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
        >0.2–10 seconds, mono 16-bit PCM WAV at 16 or 48 kHz, up to 1 MB. Tests wait up
        to 30 seconds.</small
      >
      <audio
        v-if="previewUrl"
        :src="previewUrl"
        controls
        preload="metadata"
        aria-label="Play selected audio sample"
      />
    </div>
    <div v-if="!path" class="check-field">
      <Checkbox
        :input-id="`${formId}-terms`"
        v-model="includeTerms"
        binary
        :disabled="disabled || running"
      />
      <label :for="`${formId}-terms`">Use enabled game terminology hints</label>
    </div>
    <small v-if="!path" class="muted"
      >When enabled, catalog content is also sent to recognition and translation
      providers. Disable to compare results.<a href="#terms-title"
        >Manage terminology</a
      ></small
    >
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="management-actions">
      <Button
        type="submit"
        label="Recognize and translate sample"
        :loading="running"
        :disabled="disabled || !effectiveRecognition || !effectiveTranslation || !audio"
      />
    </div>
    <div v-if="result" class="sample-result" aria-live="polite">
      <p>
        {{
          result.code === 'PASS'
            ? 'Sample processed. Check recognition and translation accuracy.'
            : result.code === 'NO_SPEECH'
              ? 'No stable speech available for translation. Check the sample.'
              : providerTestLabel(result.code)
        }}
      </p>
      <small class="muted"
        >Output {{ result.outputLanguage }} · Recognition version
        {{ result.recognitionVersion }} · Translation version
        {{ result.translationVersion }} · Request duration {{ result.elapsedMs }} ms
        (does not measure live subtitle latency)</small
      >
      <p v-if="result.terminology" class="muted">
        Catalog version {{ result.terminology.version }} · Recognition hints
        {{ result.terminology.recognitionTermCount }} terms
      </p>
      <p v-else class="muted">Terminology hints were not used for this test.</p>
      <ol class="sample-segments">
        <li v-for="segment in result.segments" :key="segment.utteranceId">
          <p class="muted">
            {{ segment.isFinal ? 'Stable original text' : 'Interim original text' }} ·
            {{ segment.language === 'und' ? 'Language undetected' : segment.language }}
          </p>
          <p>{{ segment.text || 'Original text withdrawn' }}</p>
          <p class="muted">
            {{
              segment.translationIsFinal ? 'Stable translation' : 'Interim translation'
            }}
          </p>
          <p>
            {{
              segment.failure
                ? providerTestLabel(segment.failure)
                : segment.translatedText || 'No translation yet'
            }}
          </p>
          <small class="muted"
            >Translation terminology context {{ segment.translationTermCount }} terms ·
            Provider-reported sample time: {{ segment.audioStartMs ?? 'Unknown' }}–{{
              segment.audioEndMs ?? 'Unknown'
            }}
            ms</small
          >
        </li>
      </ol>
    </div>
  </form>
</template>
