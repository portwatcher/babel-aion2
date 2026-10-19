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
      notice.value =
        'Term saved. Future sample tests use the updated catalog. Check actual translations separately.'
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
      notice.value = 'Term deleted.'
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
      <h2 id="terms-title">Game terms</h2>
      <div class="management-actions">
        <Button
          label="Add term"
          severity="secondary"
          :disabled="busy || !page"
          @click="edit(null)"
        />
        <Button
          label="Reload catalog"
          severity="secondary"
          :disabled="busy"
          @click="load()"
        />
      </div>
    </div>
    <p class="muted">
      Enter only verified AION2 Global terms. Enabled entries guide original-caption
      recognition. Live translation does not support custom glossaries. Check actual
      translations with authorized samples.
    </p>
    <form class="entry-form" @submit.prevent="load()">
      <div class="field">
        <label for="term-search">Search source term</label>
        <InputText id="term-search" v-model="query" maxlength="120" :disabled="busy" />
      </div>
      <Button
        type="submit"
        label="Search terms"
        severity="secondary"
        :disabled="busy"
      />
    </form>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="page && !page.items.length" class="muted">
      {{
        query
          ? 'No matching source terms.'
          : 'No game terms. Terms from other editions or unverified sources are not prefilled.'
      }}
    </p>
    <ul v-if="page?.items.length" class="configuration-list">
      <li v-for="term in page.items" :key="term.id">
        <div class="section-heading">
          <h3>{{ term.sourceTerm }}</h3>
          <Tag
            :value="term.enabled ? 'Used for hints' : 'Disabled'"
            severity="secondary"
          />
        </div>
        <p class="muted">
          {{ term.sourceLanguage }} · {{ term.category }} · Term version
          {{ term.version }}
        </p>
        <p v-if="term.alternatives.length" class="term-content">
          Aliases: {{ term.alternatives.join(', ') }}
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
            label="Edit"
            :aria-label="`Edit term ${term.sourceTerm}`"
            severity="secondary"
            :disabled="busy"
            @click="edit(term)"
          />
          <Button
            label="Delete"
            :aria-label="`Delete term ${term.sourceTerm}`"
            severity="danger"
            :disabled="busy"
            @click="removing = term"
          />
        </div>
      </li>
    </ul>
    <div v-if="page" class="section-heading">
      <small class="muted"
        >Catalog version {{ page.version }} · Page
        {{ Math.floor(page.offset / 50) + 1 }}</small
      >
      <div class="management-actions">
        <Button
          label="Previous terms page"
          severity="secondary"
          :disabled="busy || !page.offset"
          @click="load(Math.max(0, page.offset - 50))"
        />
        <Button
          label="Next terms page"
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
      aria-label="Confirm term deletion"
    >
      <p>
        Delete term “{{ removing.sourceTerm }}” and its expressions? To keep the
        content, disable the entry instead.
      </p>
      <div class="management-actions">
        <Button
          label="Confirm term deletion"
          severity="danger"
          :disabled="busy"
          @click="remove"
        />
        <Button
          label="Cancel term deletion"
          severity="secondary"
          :disabled="busy"
          @click="removing = null"
        />
      </div>
    </div>
  </section>
</template>
