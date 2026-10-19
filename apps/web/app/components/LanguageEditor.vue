<script setup lang="ts">
import {
  languageCodeSchema,
  languageSaveSchema,
  type LanguageSave,
  type ManagedLanguage,
  type ProviderSummary,
} from '@babel/contracts'

const props = defineProps<{
  current: ManagedLanguage | null
  providers: ProviderSummary[]
  busy: boolean
}>()
const emit = defineEmits<{ save: [code: string, input: LanguageSave]; cancel: [] }>()
const code = ref(props.current?.code ?? '')
const name = ref(props.current?.name ?? '')
const recognitionId = ref(props.current?.recognitionConfigurationId ?? '')
const translationId = ref(props.current?.translationConfigurationId ?? '')
const includeTerms = ref(props.current?.includeTerms ?? true)
const error = ref('')
const recognitionOptions = computed(() =>
  props.providers.filter((row) => row.settings.type === 'soniox'),
)
const translationOptions = computed(() =>
  props.providers.filter((row) => row.settings.type === 'deepl'),
)
onMounted(() =>
  document.getElementById(props.current ? 'output-name' : 'output-code')?.focus(),
)

function save() {
  if (props.busy) {
    return
  }
  error.value = ''
  let canonical: string
  try {
    canonical = new Intl.Locale(code.value.trim()).baseName
  } catch {
    error.value = 'Enter a valid language code, such as zh-Hans, zh-Hant, ja or ko.'
    return
  }
  const input = languageSaveSchema.safeParse({
    expectedVersion: props.current?.version ?? 0,
    name: name.value,
    recognitionConfigurationId: recognitionId.value,
    translationConfigurationId: translationId.value,
    includeTerms: includeTerms.value,
  })
  if (!languageCodeSchema.safeParse(canonical).success || !input.success) {
    error.value =
      'Check the language code and display name, and select recognition and translation configurations.'
    return
  }
  emit('save', canonical, input.data)
}
</script>

<template>
  <form class="entry-form provider-editor" @submit.prevent="save">
    <h3>
      {{ current ? `Edit output language: ${current.name}` : 'Add output language' }}
    </h3>
    <div class="management-fields">
      <div class="field">
        <label for="output-code">Language code</label>
        <InputText
          id="output-code"
          v-model="code"
          maxlength="35"
          :disabled="busy || !!current"
          placeholder="e.g. zh-Hans, ja, ko"
          required
        />
        <small class="muted"
          >Use zh-Hans for Simplified Chinese and zh-Hant for Traditional Chinese. The
          code cannot change after saving.</small
        >
      </div>
      <div class="field">
        <label for="output-name">Display name</label>
        <InputText
          id="output-name"
          v-model="name"
          maxlength="80"
          :disabled="busy"
          placeholder="e.g. Simplified Chinese"
          required
        />
      </div>
      <div class="field">
        <label for="output-recognition">Speech recognition provider</label>
        <Select
          input-id="output-recognition"
          v-model="recognitionId"
          :options="recognitionOptions"
          option-label="name"
          option-value="id"
          :disabled="busy || current?.enabled"
          placeholder="Select Soniox configuration"
        />
      </div>
      <div class="field">
        <label for="output-translation">Text translation provider</label>
        <Select
          input-id="output-translation"
          v-model="translationId"
          :options="translationOptions"
          option-label="name"
          option-value="id"
          :disabled="busy || current?.enabled"
          placeholder="Select DeepL configuration"
        />
      </div>
    </div>
    <div class="check-field">
      <Checkbox
        input-id="output-terms"
        v-model="includeTerms"
        binary
        :disabled="busy || current?.enabled"
      />
      <label for="output-terms">Use enabled game terminology hints</label>
    </div>
    <small class="muted"
      >Validate the saved path with authorized audio. When terminology hints are
      enabled, catalog content is sent to recognition and translation providers.</small
    >
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="management-actions">
      <Button
        type="submit"
        label="Save output language"
        :loading="busy"
        :disabled="busy"
      />
      <Button
        label="Cancel language editing"
        severity="secondary"
        :disabled="busy"
        @click="emit('cancel')"
      />
    </div>
  </form>
</template>
