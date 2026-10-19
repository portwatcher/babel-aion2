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
    error.value = '请输入有效的 OpenAI API Key，不能包含空格。'
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
        current ? '替换 OpenAI API Key' : 'OpenAI API Key'
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
          ? '已加密保存。留空保留已有 Key，保存后不会回显。'
          : 'Key 仅在服务器加密保存，不会发送给玩家或回显。'
      }}</small>
    </div>
    <div class="management-actions">
      <Button type="submit" label="保存 API Key" :loading="busy" />
    </div>
  </form>
</template>
