<script setup lang="ts">
import {
  providerSaveSchema,
  type ProviderSave,
  type ProviderSummary,
} from '@babel/contracts'

const props = defineProps<{ current: ProviderSummary | null; busy: boolean }>()
const emit = defineEmits<{ save: [input: ProviderSave]; cancel: [] }>()
const name = ref('')
const type = ref<'soniox' | 'deepl'>('soniox')
const model = ref('stt-rt-v5')
const endpoint = ref('https://api-free.deepl.com')
const seconds = ref('15')
const credential = ref('')
const error = ref('')
const types = [
  { label: 'Soniox · Recognition candidate', value: 'soniox' },
  { label: 'DeepL · Translation candidate', value: 'deepl' },
]
const models = [
  {
    label: 'Prefer quality, automatic compatibility',
    value: 'prefer_quality_optimized',
  },
  { label: 'Prefer quality', value: 'quality_optimized' },
  { label: 'Prefer low latency', value: 'latency_optimized' },
]
const endpoints = [
  { label: 'DeepL API Free', value: 'https://api-free.deepl.com' },
  { label: 'DeepL API Pro', value: 'https://api.deepl.com' },
]
watch(
  type,
  (value) => {
    model.value = value === 'soniox' ? 'stt-rt-v5' : 'prefer_quality_optimized'
    credential.value = ''
  },
  { flush: 'sync' },
)
watch(
  () => props.current,
  (current) => {
    name.value = current?.name ?? ''
    type.value = current?.settings.type ?? 'soniox'
    model.value = current?.settings.model ?? 'stt-rt-v5'
    endpoint.value =
      current?.settings.type === 'deepl'
        ? current.settings.endpoint
        : 'https://api-free.deepl.com'
    seconds.value = String((current?.settings.timeoutMs ?? 15_000) / 1000)
    credential.value = ''
    error.value = ''
  },
  { immediate: true },
)
function submit() {
  const input = providerSaveSchema.safeParse({
    expectedVersion: props.current?.version ?? 0,
    name: name.value,
    settings: {
      type: type.value,
      model: model.value,
      timeoutMs: Number(seconds.value) * 1000,
      ...(type.value === 'deepl' ? { endpoint: endpoint.value } : {}),
    },
    ...(credential.value ? { credential: credential.value } : {}),
  })
  if (!input.success || (!props.current && !credential.value)) {
    error.value =
      'Check the name, model, test timeout and credential. Credentials cannot contain spaces.'
    return
  }
  emit('save', input.data)
  credential.value = ''
}
onBeforeUnmount(() => {
  credential.value = ''
})
</script>

<template>
  <form class="entry-form provider-editor" @submit.prevent="submit">
    <h3>{{ current ? `Edit “${current.name}”` : 'Add candidate configuration' }}</h3>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="field">
      <label for="provider-name">Configuration name</label>
      <InputText
        id="provider-name"
        v-model="name"
        :disabled="busy"
        maxlength="80"
        required
      />
    </div>
    <div class="field">
      <label for="provider-type">Service and function</label>
      <Select
        input-id="provider-type"
        v-model="type"
        :options="types"
        option-label="label"
        option-value="value"
        :disabled="busy || current !== null"
      />
    </div>
    <div v-if="type === 'deepl'" class="field">
      <label for="provider-endpoint">API plan</label>
      <Select
        input-id="provider-endpoint"
        v-model="endpoint"
        :options="endpoints"
        option-label="label"
        option-value="value"
        :disabled="busy"
      />
    </div>
    <p v-else class="muted">Uses the official Soniox real-time speech endpoint.</p>
    <div class="field">
      <label for="provider-model">Model</label>
      <InputText
        v-if="type === 'soniox'"
        id="provider-model"
        v-model="model"
        :disabled="busy"
        required
      />
      <Select
        v-else
        input-id="provider-model"
        v-model="model"
        :options="models"
        option-label="label"
        option-value="value"
        :disabled="busy"
      />
    </div>
    <div class="field">
      <label for="provider-timeout">Connection test timeout (seconds)</label>
      <InputText
        id="provider-timeout"
        v-model="seconds"
        type="number"
        min="1"
        max="30"
        :disabled="busy"
        required
      />
    </div>
    <div class="field">
      <label for="provider-credential">{{
        current ? 'Replace API credential (optional)' : 'API credential'
      }}</label>
      <InputText
        id="provider-credential"
        v-model="credential"
        type="password"
        autocomplete="new-password"
        :spellcheck="false"
        :disabled="busy"
        :required="!current"
      />
      <small class="muted">{{
        current
          ? 'Leave blank to keep the saved credential. Its value is never returned.'
          : 'Credentials are encrypted on the server and never returned.'
      }}</small>
    </div>
    <p class="muted">
      New connection settings or credentials are tested before saving. A failed test
      preserves the previous configuration.
    </p>
    <div class="management-actions">
      <Button
        type="submit"
        :label="current ? 'Save changes' : 'Save candidate configuration'"
        :loading="busy"
      />
      <Button
        label="Cancel editing"
        severity="secondary"
        :disabled="busy"
        @click="emit('cancel')"
      />
    </div>
  </form>
</template>
