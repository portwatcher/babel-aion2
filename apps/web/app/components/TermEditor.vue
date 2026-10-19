<script setup lang="ts">
import { termSaveSchema, type GameTerm, type TermSave } from '@babel/contracts'

const props = defineProps<{ current: GameTerm | null; busy: boolean }>()
const emit = defineEmits<{ save: [value: TermSave]; cancel: [] }>()
const sourceTerm = ref(props.current?.sourceTerm ?? '')
const sourceLanguage = ref(props.current?.sourceLanguage ?? '')
const alternatives = ref(props.current?.alternatives.join('\n') ?? '')
const category = ref(props.current?.category ?? '')
const context = ref(props.current?.context ?? '')
const enabled = ref(props.current?.enabled ?? true)
const expressions = ref(
  props.current?.expressions.map((value) => ({ ...value })) ?? [
    { language: '', text: '' },
  ],
)
const error = ref('')
onMounted(() => document.getElementById('term-source')?.focus())
function save() {
  if (props.busy) {
    return
  }
  error.value = ''
  let input: TermSave
  try {
    input = {
      sourceTerm: sourceTerm.value,
      sourceLanguage: new Intl.Locale(sourceLanguage.value.trim()).baseName,
      alternatives: alternatives.value
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
      category: category.value,
      context: context.value.replace(/\r?\n/g, ' '),
      enabled: enabled.value,
      expressions: expressions.value.map((value) => ({
        language: new Intl.Locale(value.language.trim()).baseName,
        text: value.text,
      })),
      expectedVersion: props.current?.version ?? 0,
    }
  } catch {
    error.value = 'Use a valid language code, such as en, zh-Hans, zh-Hant, ja or ko.'
    return
  }
  const parsed = termSaveSchema.safeParse(input)
  if (!parsed.success) {
    error.value =
      'Check required fields and lengths. Source terms and aliases must be unique, with one expression per output language.'
    return
  }
  emit('save', parsed.data)
}
</script>

<template>
  <form class="entry-form provider-editor" @submit.prevent="save">
    <h3>{{ current ? `Edit term: ${current.sourceTerm}` : 'Add game term' }}</h3>
    <div class="management-fields">
      <div class="field">
        <label for="term-source">Source term</label>
        <InputText
          id="term-source"
          v-model="sourceTerm"
          maxlength="120"
          :disabled="busy"
          required
        />
      </div>
      <div class="field">
        <label for="term-source-language">Source language code</label>
        <InputText
          id="term-source-language"
          v-model="sourceLanguage"
          maxlength="35"
          :disabled="busy"
          placeholder="e.g. en, zh-Hant, ko"
          required
        />
      </div>
    </div>
    <div class="field">
      <label for="term-alternatives">Aliases (optional, one per line)</label>
      <Textarea
        id="term-alternatives"
        v-model="alternatives"
        rows="3"
        :disabled="busy"
        maxlength="1600"
        aria-describedby="term-alternative-limit"
      />
      <small id="term-alternative-limit" class="muted"
        >Up to 12 aliases, each up to 120 characters, in the same language as the source
        term.</small
      >
    </div>
    <div class="field">
      <label for="term-category">Game category</label>
      <InputText
        id="term-category"
        v-model="category"
        maxlength="80"
        :disabled="busy"
        required
      />
    </div>
    <div class="field">
      <label for="term-context">Short context (optional)</label>
      <Textarea
        id="term-context"
        v-model="context"
        maxlength="400"
        rows="2"
        :disabled="busy"
        aria-describedby="term-context-help"
      />
      <small id="term-context-help" class="muted"
        >Explain meaning or usage, without tactical advice. Up to 400 characters.</small
      >
    </div>
    <div class="term-expressions" role="group" aria-labelledby="term-expressions-label">
      <h4 id="term-expressions-label">Expressions by output language</h4>
      <div
        v-for="(expression, index) in expressions"
        :key="index"
        class="term-expression"
      >
        <div class="management-fields">
          <div class="field">
            <label :for="`term-language-${index}`"
              >Output language code {{ index + 1 }}</label
            >
            <InputText
              :id="`term-language-${index}`"
              v-model="expression.language"
              maxlength="35"
              :disabled="busy"
              placeholder="Match the subtitle output language code"
              required
            />
          </div>
          <div class="field">
            <label :for="`term-expression-${index}`">Expression {{ index + 1 }}</label>
            <InputText
              :id="`term-expression-${index}`"
              v-model="expression.text"
              maxlength="120"
              :disabled="busy"
              required
            />
          </div>
        </div>
        <Button
          type="button"
          label="Remove expression"
          :aria-label="`Remove output expression ${index + 1}`"
          severity="secondary"
          :disabled="busy || expressions.length === 1"
          @click="expressions.splice(index, 1)"
        />
      </div>
      <Button
        type="button"
        label="Add output language"
        severity="secondary"
        :disabled="busy || expressions.length >= 24"
        @click="expressions.push({ language: '', text: '' })"
      />
      <small class="muted"
        >Match sample output language codes. Use zh-Hans and zh-Hant for Simplified and
        Traditional Chinese respectively.</small
      >
    </div>
    <div class="check-field">
      <Checkbox input-id="term-enabled" v-model="enabled" binary :disabled="busy" />
      <label for="term-enabled"
        >Terminology hints for recognition and translation</label
      >
    </div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <small v-if="current" class="muted"
      >Editing term version {{ current.version }}</small
    >
    <div class="management-actions">
      <Button type="submit" label="Save term" :loading="busy" />
      <Button
        type="button"
        label="Cancel term editing"
        severity="secondary"
        :disabled="busy"
        @click="emit('cancel')"
      />
    </div>
  </form>
</template>
