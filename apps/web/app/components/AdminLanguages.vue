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
  return props.providers.find((provider) => provider.id === id)?.name ?? '配置不可用'
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
    '输出语言已保存。新语言需要验证路径后再启用。',
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
    '语言顺序已保存。',
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
    '默认语言设置已保存；语言开放后才会用于玩家选择。',
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
    '语言状态已更新。',
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
    '输出语言已删除。',
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
      <h2 id="languages-title">输出语言</h2>
      <div class="management-actions">
        <Button label="新增输出语言" :disabled="locked || !page" @click="edit(null)" />
        <Button
          label="重新载入语言"
          severity="secondary"
          :disabled="locked"
          @click="reload"
        />
      </div>
    </div>
    <p class="muted">
      配置玩家的字幕语言、服务路径和显示顺序。样本验证记录对应的服务及词表版本，不代表实战翻译质量已通过验收。
    </p>
    <p id="language-activation-help" class="muted">
      {{
        page?.activationAvailable
          ? '通过当前版本的样本路径验证后，可以启用语言。只有已启用的语言会显示给玩家。'
          : '字幕工作进程暂不可用。可以先保存并验证配置，恢复后再启用语言。'
      }}
    </p>
    <p v-if="page" class="muted">
      默认语言：{{ page.defaultOutputLanguage ?? '尚未设置' }}
      <Button
        v-if="page.defaultOutputLanguage"
        label="清除默认语言"
        severity="secondary"
        size="small"
        :disabled="locked"
        @click="setDefault(null)"
      />
    </p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="page && !languages.length" class="muted">
      尚无输出语言。先添加字幕服务配置，再创建语言路径。
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
          识别：{{ providerName(language.recognitionConfigurationId) }} · 翻译：{{
            providerName(language.translationConfigurationId)
          }}
        </p>
        <p class="muted">
          {{ language.enabled ? '已启用' : '未开放' }} ·
          {{ language.includeTerms ? '使用游戏术语' : '不使用游戏术语'
          }}<template v-if="page?.defaultOutputLanguage === language.code">
            · 默认语言</template
          >
        </p>
        <p v-if="language.lastAttempt" class="muted">
          最近测试：{{ languageAttemptLabel(language) }} ·
          {{ new Date(language.lastAttempt.checkedAt).toLocaleString() }}
        </p>
        <div class="management-actions">
          <Button
            label="编辑"
            :aria-label="`编辑语言 ${language.name}`"
            severity="secondary"
            :disabled="locked"
            @click="edit(language)"
          />
          <Button
            label="验证样本路径"
            :aria-label="`验证 ${language.name} 的样本路径`"
            severity="secondary"
            :disabled="locked"
            @click="showSample(language)"
          />
          <Button
            label="上移"
            :aria-label="`上移 ${language.name}`"
            severity="secondary"
            :disabled="locked || index === 0"
            @click="move(language, 'up')"
          />
          <Button
            label="下移"
            :aria-label="`下移 ${language.name}`"
            severity="secondary"
            :disabled="
              locked || (index === languages.length - 1 && page?.nextOffset === null)
            "
            @click="move(language, 'down')"
          />
          <Button
            label="设为默认"
            :aria-label="`将 ${language.name} 设为默认`"
            severity="secondary"
            :disabled="locked || page?.defaultOutputLanguage === language.code"
            @click="setDefault(language.code)"
          />
          <Button
            :label="language.enabled ? '停用' : '启用'"
            :aria-label="`${language.enabled ? '停用' : '启用'} ${language.name}`"
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
            label="删除"
            :aria-label="`删除语言 ${language.name}`"
            severity="danger"
            :disabled="locked || language.enabled"
            @click="removing = language"
          />
        </div>
      </li>
    </ul>
    <Button
      v-if="page?.nextOffset !== null && page?.nextOffset !== undefined"
      label="载入更多语言"
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
      aria-label="确认删除输出语言"
    >
      <p>
        删除「{{
          removing.name
        }}」的配置和验证记录？如果它是默认语言，默认选择也会清除。
      </p>
      <div class="management-actions">
        <Button
          label="确认删除语言"
          severity="danger"
          :disabled="locked"
          @click="remove"
        />
        <Button
          label="取消删除语言"
          severity="secondary"
          :disabled="locked"
          @click="removing = null"
        />
      </div>
    </div>
  </section>
</template>
