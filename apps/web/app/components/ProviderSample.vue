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
    error.value = 'Save an API Key and select an audio sample no larger than 1 MB.'
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
      Use the saved OpenAI API Key to compare original and translated text from an
      authorized sample. Test text stays on this page; it does not enable languages or
      reach players.
    </p>
    <p v-if="path" class="muted">
      Output {{ path.code }} ·
      {{ path.includeTerms ? 'Use terminology hints' : 'No terminology hints' }}.
      Validation status is saved with this language configuration.
    </p>
    <p class="muted">
      Audio is sent concurrently to OpenAI recognition and target-language translation
      sessions and incurs service charges. Use authorized samples; the server does not
      persist audio or test text. Recognition and translation stream during processing;
      this finite comparison appears after completion.
    </p>
    <div v-if="!path" class="field">
      <label :for="`${formId}-language`">Sample output language code</label>
      <InputText
        :id="`${formId}-language`"
        v-model="outputLanguage"
        :disabled="disabled || running"
        maxlength="35"
        placeholder="For example: zh-Hans, ja, ko"
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
        >0.2–10 seconds, mono PCM16 WAV, 16 or 48 kHz, up to 1 MB. Tests time out after
        30 seconds.</small
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
      >Hints apply only to recognition. Live translation does not support custom
      glossaries. Disable hints to compare results.
      <a href="#terms-title">Manage terminology</a></small
    >
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="management-actions">
      <Button
        type="submit"
        label="Transcribe and translate sample"
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
              ? 'No completed source speech was recognized. Check the sample.'
              : providerTestLabel(result.code)
        }}
      </p>
      <small class="muted"
        >Output {{ result.outputLanguage }} · recognition version
        {{ result.recognitionVersion }} · translation version
        {{ result.translationVersion }} · request duration {{ result.elapsedMs }} ms
        (not live subtitle latency)</small
      >
      <p v-if="result.terminology" class="muted">
        Terminology version {{ result.terminology.version }} · recognition hints
        {{ result.terminology.recognitionTermCount }} entries
      </p>
      <p v-else class="muted">No terminology hints used.</p>
      <ol class="sample-segments">
        <li v-for="segment in result.segments" :key="segment.utteranceId">
          <p class="muted">
            {{
              segment.sourceAlignment === 'independent'
                ? 'Independent source stream'
                : 'Source text'
            }}
            · {{ segment.isFinal ? 'Recognition complete' : 'Recognizing' }} ·
            {{
              segment.language === 'und' ? 'Language undetermined' : segment.language
            }}
          </p>
          <p>{{ segment.text || 'Source text unavailable' }}</p>
          <p class="muted">
            {{
              segment.translationIsFinal
                ? 'Completed translation'
                : 'Streaming translation'
            }}
          </p>
          <p>
            {{
              segment.failure
                ? providerTestLabel(segment.failure)
                : segment.translatedText || 'No translated text'
            }}
          </p>
          <small class="muted"
            >Translation terminology context {{ segment.translationTermCount }} entries
            · Provider sample time: {{ segment.audioStartMs ?? 'unknown' }}–{{
              segment.audioEndMs ?? 'unknown'
            }}
            ms</small
          >
        </li>
      </ol>
    </div>
  </form>
</template>
