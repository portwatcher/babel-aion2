<script setup lang="ts">
import {
  providerListSchema,
  providerSummarySchema,
  type ProviderSave,
  type ProviderSummary,
} from '@babel/contracts'
import { providerFailure, providerTestLabel } from '~/utils/provider-feedback'

defineProps<{ terminologyVersion: number | null }>()
const emit = defineEmits<{ change: [providers: ProviderSummary[]] }>()

const providers = shallowRef<ProviderSummary[]>([])
const protectionReady = ref(false)
const busy = ref(false)
const loaded = ref(false)
const error = ref('')
const notice = ref('')
const editing = ref(false)
const selected = shallowRef<ProviderSummary | null>(null)
const removing = shallowRef<ProviderSummary | null>(null)
const restoreVersion = ref<number | null>(null)
const candidateId = ref('')
let disposed = false

async function load() {
  busy.value = true
  error.value = ''
  try {
    const response = providerListSchema.parse(await $fetch('/api/management/providers'))
    if (!disposed) {
      providers.value = response.configurations
      emit('change', providers.value)
      protectionReady.value = response.credentialProtectionReady
      loaded.value = true
      editing.value = false
      selected.value = null
      removing.value = null
    }
  } catch (failure) {
    if (!disposed) {
      error.value = providerFailure(failure)
    }
  } finally {
    busy.value = false
  }
}
function edit(provider: ProviderSummary | null) {
  selected.value = provider
  candidateId.value = provider?.id ?? crypto.randomUUID()
  restoreVersion.value = null
  editing.value = true
  notice.value = ''
  error.value = ''
}
function accept(provider: ProviderSummary) {
  providers.value = [
    ...providers.value.filter((row) => row.id !== provider.id),
    provider,
  ]
  emit('change', providers.value)
  if (editing.value && candidateId.value === provider.id) {
    selected.value = provider
  }
}
async function operation(action: () => Promise<unknown>, success: string) {
  if (busy.value) {
    return
  }
  busy.value = true
  notice.value = ''
  error.value = ''
  try {
    const provider = providerSummarySchema.parse(await action())
    if (!disposed) {
      accept(provider)
      notice.value = success
    }
  } catch (failure) {
    if (!disposed) {
      error.value = providerFailure(failure)
    }
  } finally {
    busy.value = false
  }
}
async function save(input: ProviderSave) {
  await operation(
    () =>
      $fetch<unknown, string>(`/api/management/providers/${candidateId.value}`, {
        method: 'PUT',
        body: input,
      }),
    'Configuration saved. Subtitle delivery is not enabled yet.',
  )
}
async function test(provider: ProviderSummary) {
  await operation(
    () =>
      $fetch<unknown, string>(`/api/management/providers/${provider.id}/test`, {
        method: 'POST',
        body: { expectedVersion: provider.version },
      }),
    'Connection test complete. Check the result for this configuration.',
  )
}
async function restore() {
  const provider = selected.value
  if (!provider || !restoreVersion.value) {
    return
  }
  await operation(
    () =>
      $fetch<unknown, string>(`/api/management/providers/${provider.id}/restore`, {
        method: 'POST',
        body: {
          expectedVersion: provider.version,
          restoreVersion: restoreVersion.value,
        },
      }),
    'Historical settings passed the connection test and were saved as a new version.',
  )
  restoreVersion.value = null
}
async function remove() {
  if (!removing.value || busy.value) {
    return
  }
  const provider = removing.value
  busy.value = true
  error.value = ''
  try {
    await $fetch<unknown, string>(`/api/management/providers/${provider.id}`, {
      method: 'DELETE',
      body: { expectedVersion: provider.version },
    })
    if (!disposed) {
      providers.value = providers.value.filter((row) => row.id !== provider.id)
      emit('change', providers.value)
      removing.value = null
      if (selected.value?.id === provider.id) {
        editing.value = false
        selected.value = null
      }
      notice.value = 'Configuration and credential history deleted.'
    }
  } catch (failure) {
    if (!disposed) {
      error.value = providerFailure(failure)
    }
  } finally {
    busy.value = false
  }
}
onMounted(load)
onBeforeUnmount(() => {
  disposed = true
})
</script>

<template>
  <section
    class="management-section"
    aria-labelledby="providers-title"
    :aria-busy="busy"
  >
    <div class="section-heading">
      <h2 id="providers-title">Subtitle provider configurations</h2>
      <div class="management-actions">
        <Button
          label="Add candidate configuration"
          :disabled="busy || !loaded || !protectionReady"
          @click="edit(null)"
        />
        <Button
          label="Reload providers"
          severity="secondary"
          :disabled="busy"
          @click="load"
        />
      </div>
    </div>
    <p class="muted">
      Connection tests check credentials and model access. Then validate the output
      language sample path and enable the language manually.
    </p>
    <p class="muted">
      Soniox tests send one second of silence. DeepL tests translate a fixed English
      phrase into German. Tests and connection updates may incur provider charges.
    </p>
    <p v-if="loaded && !protectionReady" class="muted">
      Credential protection is not configured. Providers cannot be saved or tested yet.
    </p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="loaded && !providers.length" class="muted">
      No provider configurations. Production subtitle languages remain empty.
    </p>
    <ul v-else class="configuration-list">
      <li v-for="provider in providers" :key="provider.id">
        <div class="section-heading">
          <h3>{{ provider.name }}</h3>
          <Tag
            :value="
              provider.lastTest
                ? providerTestLabel(provider.lastTest.code)
                : 'Not tested'
            "
            :severity="provider.lastTest?.code === 'PASS' ? 'success' : 'secondary'"
          />
        </div>
        <p class="muted">
          {{
            provider.settings.type === 'soniox'
              ? 'Soniox · Recognition candidate'
              : 'DeepL · Translation candidate'
          }}
          · Version {{ provider.version }}
        </p>
        <small v-if="provider.lastTest" class="muted"
          >Last test {{ new Date(provider.lastTest.checkedAt).toLocaleString('en') }} ·
          {{ provider.lastTest.durationMs }} ms; This does not validate subtitle
          quality.</small
        >
        <div class="management-actions">
          <Button
            :aria-label="`Edit ${provider.name}`"
            label="Edit"
            severity="secondary"
            :disabled="busy || !protectionReady"
            @click="edit(provider)"
          />
          <Button
            :aria-label="`Test ${provider.name}`"
            label="Test saved configuration"
            severity="secondary"
            :disabled="busy || !protectionReady"
            @click="test(provider)"
          />
          <Button
            :aria-label="`Delete ${provider.name}`"
            label="Delete"
            severity="danger"
            :disabled="busy"
            @click="removing = provider"
          />
        </div>
      </li>
    </ul>
    <ProviderEditor
      v-if="editing"
      :key="candidateId"
      :current="selected"
      :busy="busy"
      @save="save"
      @cancel="editing = false"
    />
    <div v-if="editing && selected?.history.length" class="management-confirmation">
      <label for="provider-history"
        >Restore historical settings (latest 20 versions)</label
      >
      <Select
        input-id="provider-history"
        v-model="restoreVersion"
        :options="
          selected.history.map((row) => ({
            label: `Version ${row.version} · ${row.name}`,
            value: row.version,
          }))
        "
        option-label="label"
        option-value="value"
        :disabled="busy"
        placeholder="Select a historical version"
      />
      <Button
        label="Test and restore version"
        severity="secondary"
        :disabled="busy || !restoreVersion"
        @click="restore"
      />
    </div>
    <ProviderSample
      :terminology-version="terminologyVersion"
      :providers="providers"
      :disabled="busy || !loaded || !protectionReady"
      @busy="busy = $event"
    />
    <div
      v-if="removing"
      class="management-confirmation"
      role="group"
      aria-label="Confirm provider deletion"
    >
      <p>Delete “{{ removing.name }}” and all its credential history?</p>
      <div class="management-actions">
        <Button
          label="Confirm deletion"
          severity="danger"
          :disabled="busy"
          @click="remove"
        />
        <Button
          label="Cancel deletion"
          severity="secondary"
          :disabled="busy"
          @click="removing = null"
        />
      </div>
    </div>
  </section>
</template>
