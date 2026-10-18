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
    error.value = '请使用有效的语言代码，例如 en、zh-Hans、zh-Hant、ja 或 ko。'
    return
  }
  const parsed = termSaveSchema.safeParse(input)
  if (!parsed.success) {
    error.value =
      '请检查必填项与长度。原词和别称不能重复，每个输出语言只能填写一种表达。'
    return
  }
  emit('save', parsed.data)
}
</script>

<template>
  <form class="entry-form provider-editor" @submit.prevent="save">
    <h3>{{ current ? `编辑术语：${current.sourceTerm}` : '新增游戏术语' }}</h3>
    <div class="management-fields">
      <div class="field">
        <label for="term-source">原词</label>
        <InputText
          id="term-source"
          v-model="sourceTerm"
          maxlength="120"
          :disabled="busy"
          required
        />
      </div>
      <div class="field">
        <label for="term-source-language">来源语言代码</label>
        <InputText
          id="term-source-language"
          v-model="sourceLanguage"
          maxlength="35"
          :disabled="busy"
          placeholder="例如 en、zh-Hant、ko"
          required
        />
      </div>
    </div>
    <div class="field">
      <label for="term-alternatives">别称（可选，每行一个）</label>
      <Textarea
        id="term-alternatives"
        v-model="alternatives"
        rows="3"
        :disabled="busy"
        maxlength="1600"
        aria-describedby="term-alternative-limit"
      />
      <small id="term-alternative-limit" class="muted"
        >最多 12 个，每个不超过 120 字符；与原词使用同一来源语言。</small
      >
    </div>
    <div class="field">
      <label for="term-category">游戏分类</label>
      <InputText
        id="term-category"
        v-model="category"
        maxlength="80"
        :disabled="busy"
        required
      />
    </div>
    <div class="field">
      <label for="term-context">短说明（可选）</label>
      <Textarea
        id="term-context"
        v-model="context"
        maxlength="400"
        rows="2"
        :disabled="busy"
        aria-describedby="term-context-help"
      />
      <small id="term-context-help" class="muted"
        >解释词义或使用场景，不添加战术建议。最多 400 字符。</small
      >
    </div>
    <div class="term-expressions" role="group" aria-labelledby="term-expressions-label">
      <h4 id="term-expressions-label">各输出语言的表达</h4>
      <div
        v-for="(expression, index) in expressions"
        :key="index"
        class="term-expression"
      >
        <div class="management-fields">
          <div class="field">
            <label :for="`term-language-${index}`">输出语言代码 {{ index + 1 }}</label>
            <InputText
              :id="`term-language-${index}`"
              v-model="expression.language"
              maxlength="35"
              :disabled="busy"
              placeholder="与字幕输出语言代码一致"
              required
            />
          </div>
          <div class="field">
            <label :for="`term-expression-${index}`">对应表达 {{ index + 1 }}</label>
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
          label="移除此表达"
          :aria-label="`移除输出表达 ${index + 1}`"
          severity="secondary"
          :disabled="busy || expressions.length === 1"
          @click="expressions.splice(index, 1)"
        />
      </div>
      <Button
        type="button"
        label="添加输出语言"
        severity="secondary"
        :disabled="busy || expressions.length >= 24"
        @click="expressions.push({ language: '', text: '' })"
      />
      <small class="muted"
        >语言代码须与样本输出一致。简体与繁体请分别填写 zh-Hans、zh-Hant。</small
      >
    </div>
    <div class="check-field">
      <Checkbox input-id="term-enabled" v-model="enabled" binary :disabled="busy" />
      <label for="term-enabled">用于识别与翻译的术语提示</label>
    </div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <small v-if="current" class="muted">正在编辑词条版本 {{ current.version }}</small>
    <div class="management-actions">
      <Button type="submit" label="保存术语" :loading="busy" />
      <Button
        type="button"
        label="取消术语编辑"
        severity="secondary"
        :disabled="busy"
        @click="emit('cancel')"
      />
    </div>
  </form>
</template>
