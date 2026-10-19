<script setup lang="ts">
import {
  providerSaveSchema,
  type ProviderSave,
  type ProviderSummary,
} from '@babel/contracts'
const props = defineProps<{ current: ProviderSummary | null; busy: boolean }>()
const emit = defineEmits<{ save: [input: ProviderSave]; cancel: [] }>()
const credential = ref('')
const error = ref('')
watch(
  () => props.current,
  () => {
    credential.value = ''
    error.value = ''
  },
)
function submit() {
  const input = providerSaveSchema.safeParse({
    expectedVersion: props.current?.version ?? 0,
    ...(credential.value ? { credential: credential.value } : {}),
  })
  if (!input.success || (!props.current && !credential.value)) {
    error.value = 'Enter a valid OpenAI API Key without spaces.'
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
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="field">
      <label for="provider-credential">{{
        current ? 'Replace OpenAI API Key' : 'OpenAI API Key'
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
          ? 'Encrypted. Leave blank to keep the saved key.'
          : 'Encrypted on the server and never shown again.'
      }}</small>
    </div>
    <div class="management-actions">
      <Button type="submit" label="Save API Key" :loading="busy" />
    </div>
  </form>
</template>
