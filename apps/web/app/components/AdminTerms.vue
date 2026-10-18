<script setup lang="ts">
import {
  termPageSchema,
  termRecordSchema,
  type GameTerm,
  type TermPage,
  type TermSave,
} from '@babel/contracts'
import { termFailure } from '~/utils/term-feedback'

const emit = defineEmits<{ version: [value: number] }>()
const page = shallowRef<TermPage | null>(null)
const query = ref('')
const appliedQuery = ref('')
const selected = shallowRef<GameTerm | null>(null)
const removing = shallowRef<GameTerm | null>(null)
const candidateId = ref('')
const editing = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
let disposed = false
async function readPage(offset: number) {
  if (query.value !== appliedQuery.value) {
    offset = 0
  }
  const result = termPageSchema.parse(
    await $fetch('/api/management/terms', {
      query: {
        offset,
        query: query.value,
        ...(offset ? { expectedVersion: page.value?.version } : {}),
      },
    }),
  )
  if (!disposed) {
    page.value = result
    appliedQuery.value = query.value
    editing.value = false
    selected.value = null
    removing.value = null
    emit('version', result.version)
  }
}
async function load(offset = 0) {
  if (busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await readPage(offset)
  } catch (failure) {
    if (!disposed) {
      error.value = termFailure(failure)
    }
  } finally {
    busy.value = false
  }
}
function edit(term: GameTerm | null) {
  selected.value = term
  candidateId.value = term?.id ?? crypto.randomUUID()
  editing.value = true
  removing.value = null
  error.value = ''
  notice.value = ''
}
async function save(input: TermSave) {
  if (busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const term = termRecordSchema.parse(
      await $fetch<unknown, string>(`/api/management/terms/${candidateId.value}`, {
        method: 'PUT',
        body: input,
      }),
    )
    if (!disposed) {
      emit('version', term.version)
      query.value = ''
      await readPage(0)
      notice.value = '术语已保存，后续样本测试使用新词表。实际译法仍需核对。'
    }
  } catch (failure) {
    if (!disposed) {
      error.value = termFailure(failure)
    }
  } finally {
    busy.value = false
  }
}
async function remove() {
  if (!removing.value || busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await $fetch<unknown, string>(`/api/management/terms/${removing.value.id}`, {
      method: 'DELETE',
      body: { expectedVersion: removing.value.version },
    })
    if (!disposed) {
      await readPage(0)
      notice.value = '术语已删除。'
    }
  } catch (failure) {
    if (!disposed) {
      error.value = termFailure(failure)
    }
  } finally {
    busy.value = false
  }
}
onMounted(() => load())
onBeforeUnmount(() => {
  disposed = true
})
</script>

<template>
  <section class="management-section" aria-labelledby="terms-title" :aria-busy="busy">
    <div class="section-heading">
      <h2 id="terms-title">游戏术语</h2>
      <div class="management-actions">
        <Button
          label="新增术语"
          severity="secondary"
          :disabled="busy || !page"
          @click="edit(null)"
        />
        <Button
          label="重新载入术语表"
          severity="secondary"
          :disabled="busy"
          @click="load()"
        />
      </div>
    </div>
    <p class="muted">
      仅录入已核对的 AION2
      国际服术语。识别与翻译使用已启用词条作为上下文提示，保存词条不代表实际译法已验证。
    </p>
    <form class="entry-form" @submit.prevent="load()">
      <div class="field">
        <label for="term-search">搜索原词</label>
        <InputText id="term-search" v-model="query" maxlength="120" :disabled="busy" />
      </div>
      <Button type="submit" label="搜索术语" severity="secondary" :disabled="busy" />
    </form>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="page && !page.items.length" class="muted">
      {{
        query
          ? '没有匹配的原词。'
          : '尚无游戏术语。不会预填其他版本或未经核对的游戏用词。'
      }}
    </p>
    <ul v-if="page?.items.length" class="configuration-list">
      <li v-for="term in page.items" :key="term.id">
        <div class="section-heading">
          <h3>{{ term.sourceTerm }}</h3>
          <Tag :value="term.enabled ? '用于提示' : '已停用'" severity="secondary" />
        </div>
        <p class="muted">
          {{ term.sourceLanguage }} · {{ term.category }} · 词条版本 {{ term.version }}
        </p>
        <p v-if="term.alternatives.length" class="term-content">
          别称：{{ term.alternatives.join('、') }}
        </p>
        <dl class="term-translations">
          <div v-for="expression in term.expressions" :key="expression.language">
            <dt>{{ expression.language }}</dt>
            <dd>{{ expression.text }}</dd>
          </div>
        </dl>
        <p v-if="term.context" class="muted term-content">{{ term.context }}</p>
        <div class="management-actions">
          <Button
            label="编辑"
            :aria-label="`编辑术语 ${term.sourceTerm}`"
            severity="secondary"
            :disabled="busy"
            @click="edit(term)"
          />
          <Button
            label="删除"
            :aria-label="`删除术语 ${term.sourceTerm}`"
            severity="danger"
            :disabled="busy"
            @click="removing = term"
          />
        </div>
      </li>
    </ul>
    <div v-if="page" class="section-heading">
      <small class="muted"
        >词表版本 {{ page.version }} · 第
        {{ Math.floor(page.offset / 50) + 1 }} 页</small
      >
      <div class="management-actions">
        <Button
          label="上一页术语"
          severity="secondary"
          :disabled="busy || !page.offset"
          @click="load(Math.max(0, page.offset - 50))"
        />
        <Button
          label="下一页术语"
          severity="secondary"
          :disabled="busy || page.nextOffset === null"
          @click="load(page.nextOffset ?? 0)"
        />
      </div>
    </div>
    <TermEditor
      v-if="editing"
      :key="candidateId"
      :current="selected"
      :busy="busy"
      @save="save"
      @cancel="editing = false"
    />
    <div
      v-if="removing"
      class="management-confirmation"
      role="group"
      aria-label="确认删除术语"
    >
      <p>
        删除术语「{{
          removing.sourceTerm
        }}」及其各语言表达？如需保留内容，可在编辑中停用。
      </p>
      <div class="management-actions">
        <Button
          label="确认删除术语"
          severity="danger"
          :disabled="busy"
          @click="remove"
        />
        <Button
          label="取消删除术语"
          severity="secondary"
          :disabled="busy"
          @click="removing = null"
        />
      </div>
    </div>
  </section>
</template>
