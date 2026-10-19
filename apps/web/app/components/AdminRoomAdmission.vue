<script setup lang="ts">
import { ASIA_SERVERS, roomAdmissionSchema } from '@babel/contracts'
import { managementFailure } from '~/utils/management-errors'
const emit = defineEmits<{ published: [] }>()
const roomQuery = useManagementRoomQuery()
const admission = shallowRef<{ server: string; allowedIds: string[] } | null>(null)
const server = ref<string | null>(null)
const allowed = ref('')
const busy = ref(false)
const error = ref('')
const loaded = ref(false)
async function load() {
  busy.value = true
  try {
    admission.value = (
      await $fetch('/api/management/room/admission', { query: roomQuery.value })
    ).admission
    loaded.value = true
  } catch (failure) {
    error.value = managementFailure(failure)
  } finally {
    busy.value = false
  }
}
async function publish() {
  const input = roomAdmissionSchema.safeParse({
    server: server.value,
    allowedIds: allowed.value
      .split(/\r?\n/)
      .map((id) => id.trim())
      .filter(Boolean),
  })
  if (!input.success) {
    error.value = '请选择区服并检查角色 ID 名单'
    return
  }
  busy.value = true
  error.value = ''
  try {
    admission.value = (
      await $fetch('/api/management/room/admission', {
        method: 'POST',
        query: roomQuery.value,
        body: input.data,
      })
    ).admission
    emit('published')
  } catch (failure) {
    error.value = managementFailure(failure)
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <section class="management-section" aria-labelledby="admission-title">
    <h2 id="admission-title">加入规则</h2>
    <template v-if="admission">
      <p>
        Asia / {{ admission.server }} ·
        {{ admission.allowedIds.length ? '指定角色可加入' : '本区服所有角色可加入' }}
      </p>
      <p v-if="admission.allowedIds.length" class="muted">
        {{ admission.allowedIds.join('、') }}
      </p>
      <p class="muted">房间已加入公开列表，成员进入时需通过 AION2 Index 角色校验。</p>
    </template>
    <form v-else-if="loaded" class="entry-form" @submit.prevent="publish">
      <p class="muted">
        为原有房间设置区服后，它会显示在房间列表中，并沿用当前 Discord
        来源。现有成员需要退出后重新验证角色。
      </p>
      <div class="field">
        <label for="existing-room-server">区服（必选）</label>
        <Select
          input-id="existing-room-server"
          v-model="server"
          :options="[...ASIA_SERVERS]"
          :disabled="busy"
          placeholder="选择 Asia 区服"
        />
      </div>
      <div class="field">
        <label for="existing-room-ids">允许加入的角色 ID（可选）</label>
        <Textarea
          id="existing-room-ids"
          v-model="allowed"
          rows="4"
          :disabled="busy"
          placeholder="每行一个 ID，留空允许本区服所有角色加入"
        />
      </div>
      <Button type="submit" label="设置区服并开放原有房间" :loading="busy" />
    </form>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <Button
      v-if="!loaded && !busy"
      label="重新加载加入规则"
      severity="secondary"
      @click="load"
    />
  </section>
</template>
