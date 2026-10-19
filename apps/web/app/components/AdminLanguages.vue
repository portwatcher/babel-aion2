<script setup lang="ts">
const roomQuery = useManagementRoomQuery()
import {
  languagePageSchema,
  type LanguagePage,
  type LanguageSave,
  type ManagedLanguage,
  type ProviderSummary,
} from '@babel/contracts'
import {
  languageFailure,
  languageValidationLabel,
  languageAttemptLabel,
} from '~/utils/language-feedback'

const props = defineProps<{
  providers: ProviderSummary[]
  terminologyVersion: number | null
}>()
const page = shallowRef<LanguagePage | null>(null)
const languages = shallowRef<ManagedLanguage[]>([])
const busy = ref(false)
const sampleRunning = ref(false)
const locked = computed(() => busy.value || sampleRunning.value)
const error = ref('')
const notice = ref('')
const editing = ref(false)
const selected = shallowRef<ManagedLanguage | null>(null)
const sample = shallowRef<ManagedLanguage | null>(null)
const removing = shallowRef<ManagedLanguage | null>(null)
let disposed = false
let refreshPending = false
let request = 0

async function load(append = false) {
  const ticket = ++request
  busy.value = true
  error.value = ''
  refreshPending = false
  try {
    const result = languagePageSchema.parse(
      await $fetch('/api/management/languages', {
        query: {
          ...roomQuery.value,
          ...(append && page.value
            ? { offset: page.value.nextOffset, expectedVersion: page.value.version }
            : {}),
        },
      }),
    )
    if (!disposed && ticket === request) {
      page.value = result
      languages.value = append ? [...languages.value, ...result.items] : result.items
      if (sample.value) {
        sample.value =
          languages.value.find((row) => row.code === sample.value?.code) ?? null
      }
    }
  } catch (failure) {
    if (!disposed && ticket === request) {
      error.value = languageFailure(failure)
    }
  } finally {
    if (ticket === request) {
      busy.value = false
    }
  }
}
function edit(language: ManagedLanguage | null) {
  selected.value = language
  editing.value = true
  sample.value = null
  removing.value = null
  notice.value = ''
  error.value = ''
}
function showSample(language: ManagedLanguage) {
  sample.value = language
  editing.value = false
  removing.value = null
}
function reload() {
  editing.value = false
  removing.value = null
  return load()
}
function providerName(id: string | null) {
  return (
    props.providers.find((provider) => provider.id === id)?.name ??
    'Configuration unavailable'
  )
}
async function mutate(action: () => Promise<unknown>, message: string) {
  if (locked.value) {
    return
  }
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await action()
    if (!disposed) {
      editing.value = false
      removing.value = null
      notice.value = message
      await load()
    }
  } catch (failure) {
    if (!disposed) {
      error.value = languageFailure(failure)
    }
  } finally {
    busy.value = false
  }
}
function save(code: string, input: LanguageSave) {
  return mutate(
    () =>
      $fetch<unknown, string>(`/api/management/languages/${code}`, {
        query: roomQuery.value,
        method: 'PUT',
        body: input,
      }),
    'Output language saved. Validate its path before enabling it.',
  )
}
function move(language: ManagedLanguage, direction: 'up' | 'down') {
  return mutate(
    () =>
      $fetch<unknown, string>(`/api/management/languages/${language.code}/move`, {
        query: roomQuery.value,
        method: 'POST',
        body: { direction, expectedCatalogVersion: page.value?.version },
      }),
    'Language order saved.',
  )
}
function setDefault(code: string | null) {
  return mutate(
    () =>
      $fetch<unknown, string>('/api/management/languages/default', {
        query: roomQuery.value,
        method: 'POST',
        body: { code, expectedCatalogVersion: page.value?.version },
      }),
    'Default language saved. It applies to player selection once the language is enabled.',
  )
}
function setState(language: ManagedLanguage) {
  return mutate(
    () =>
      $fetch<unknown, string>(`/api/management/languages/${language.code}/state`, {
        query: roomQuery.value,
        method: 'POST',
        body: { enabled: !language.enabled, expectedVersion: language.version },
      }),
    'Language state updated.',
  )
}
function remove() {
  const language = removing.value
  if (!language) {
    return
  }
  return mutate(
    () =>
      $fetch<unknown, string>(`/api/management/languages/${language.code}`, {
        query: roomQuery.value,
        method: 'DELETE',
        body: { expectedVersion: language.version },
      }),
    'Output language deleted.',
  )
}
function validated(language: ManagedLanguage) {
  sample.value = language
  languages.value = languages.value.map((row) =>
    row.code === language.code ? language : row,
  )
  refreshPending = true
}
watch([() => props.providers, () => props.terminologyVersion], () => {
  if (locked.value) {
    refreshPending = true
  } else {
    void load()
  }
})
watch(locked, (value) => {
  if (!value && refreshPending && !disposed) {
    void load()
  }
})
onMounted(() => load())
onBeforeUnmount(() => {
  disposed = true
})
</script>

<template>
  <section
    class="management-section"
    aria-labelledby="languages-title"
    :aria-busy="locked"
  >
    <div class="section-heading">
      <h2 id="languages-title">Output languages</h2>
      <div class="management-actions">
        <Button
          label="Add output language"
          :disabled="locked || !page"
          @click="edit(null)"
        />
        <Button
          label="Reload languages"
          severity="secondary"
          :disabled="locked"
          @click="reload"
        />
      </div>
    </div>

    <p id="language-activation-help" class="muted">
      {{
        page?.activationAvailable
          ? 'Validate a language before enabling it. Players only see enabled languages.'
          : 'Subtitle worker unavailable. You can save and validate, but not enable.'
      }}
    </p>
    <p v-if="page" class="muted">
      Default language: {{ page.defaultOutputLanguage ?? 'Not set' }}
      <Button
        v-if="page.defaultOutputLanguage"
        label="Clear default language"
        severity="secondary"
        size="small"
        :disabled="locked"
        @click="setDefault(null)"
      />
    </p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="page && !languages.length" class="muted">
      No output languages. Save an OpenAI API key, then add one.
    </p>
    <ul v-else class="configuration-list">
      <li v-for="(language, index) in languages" :key="language.code">
        <div class="section-heading">
          <h3>
            {{ language.name }} <small class="muted">{{ language.code }}</small>
          </h3>
          <Tag
            :value="languageValidationLabel(language)"
            :severity="language.validationState === 'CURRENT' ? 'success' : 'secondary'"
          />
        </div>
        <p class="muted">
          Recognition: {{ providerName(language.recognitionConfigurationId) }} ·
          Translation: {{ providerName(language.translationConfigurationId) }}
        </p>
        <p class="muted">
          {{ language.enabled ? 'Enabled' : 'Disabled' }} ·
          {{ language.includeTerms ? 'Use game terms' : 'No game terms'
          }}<template v-if="page?.defaultOutputLanguage === language.code">
            · Default language</template
          >
        </p>
        <p v-if="language.lastAttempt" class="muted">
          Latest test: {{ languageAttemptLabel(language) }} ·
          {{ new Date(language.lastAttempt.checkedAt).toLocaleString('en') }}
        </p>
        <div class="management-actions">
          <Button
            label="Edit"
            :aria-label="`Edit language ${language.name}`"
            severity="secondary"
            :disabled="locked"
            @click="edit(language)"
          />
          <Button
            label="Validate sample path"
            :aria-label="`Validate ${language.name} sample path`"
            severity="secondary"
            :disabled="locked"
            @click="showSample(language)"
          />
          <Button
            label="Move up"
            :aria-label="`Move up ${language.name}`"
            severity="secondary"
            :disabled="locked || index === 0"
            @click="move(language, 'up')"
          />
          <Button
            label="Move down"
            :aria-label="`Move down ${language.name}`"
            severity="secondary"
            :disabled="
              locked || (index === languages.length - 1 && page?.nextOffset === null)
            "
            @click="move(language, 'down')"
          />
          <Button
            label="Set as default"
            :aria-label="`Set ${language.name} as default`"
            severity="secondary"
            :disabled="locked || page?.defaultOutputLanguage === language.code"
            @click="setDefault(language.code)"
          />
          <Button
            :label="language.enabled ? 'Disable' : 'Enable'"
            :aria-label="`${language.enabled ? 'Disable' : 'Enable'} ${language.name}`"
            aria-describedby="language-activation-help"
            severity="secondary"
            :disabled="
              locked ||
              (!language.enabled &&
                (!page?.activationAvailable || language.validationState !== 'CURRENT'))
            "
            @click="setState(language)"
          />
          <Button
            label="Delete"
            :aria-label="`Delete language ${language.name}`"
            severity="danger"
            :disabled="locked || language.enabled"
            @click="removing = language"
          />
        </div>
      </li>
    </ul>
    <Button
      v-if="page?.nextOffset !== null && page?.nextOffset !== undefined"
      label="Load more languages"
      severity="secondary"
      :disabled="locked"
      @click="load(true)"
    />
    <LanguageEditor
      v-if="editing"
      :key="selected?.code ?? 'new'"
      :current="selected"
      :providers="providers"
      :busy="locked"
      @save="save"
      @cancel="editing = false"
    />
    <ProviderSample
      v-if="sample"
      :path="sample"
      :providers="providers"
      :terminology-version="terminologyVersion"
      :disabled="busy"
      @busy="sampleRunning = $event"
      @validated="validated"
    />
    <div
      v-if="removing"
      class="management-confirmation"
      role="group"
      aria-label="Confirm output language deletion"
    >
      <p>
        Delete “{{ removing.name }}” configuration and validation records? The default
        selection will also be cleared if it uses this language.
      </p>
      <div class="management-actions">
        <Button
          label="Confirm language deletion"
          severity="danger"
          :disabled="locked"
          @click="remove"
        />
        <Button
          label="Cancel language deletion"
          severity="secondary"
          :disabled="locked"
          @click="removing = null"
        />
      </div>
    </div>
  </section>
</template>
