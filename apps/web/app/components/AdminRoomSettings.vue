<script setup lang="ts">
import {
  managementRoomResponseSchema,
  managementRoomSchema,
  roomUpdateSchema,
  type ManagementRoom,
  type DiscordCaptureMode,
} from '@babel/contracts'
import { managementFailure } from '~/utils/management-errors'

const current = shallowRef<ManagementRoom | null>(null)
const protectionReady = ref(false)
const name = ref('')
const guildId = ref('')
const voiceChannelId = ref('')
const captureMode = ref<DiscordCaptureMode>('SELECTED_USERS')
const captureModes = [
  { label: '指定成员', value: 'SELECTED_USERS' },
  { label: '频道全部成员', value: 'ALL_CHANNEL' },
]
const commanderText = ref('')
const credentialAction = ref<'keep' | 'replace' | 'remove'>('keep')
const credential = ref('')
const busy = ref(false)
const error = ref('')
const notice = ref('')
let disposed = false
const credentialActions = computed(() => [
  {
    label: current.value?.credentialConfigured ? '保留已保存的凭据' : '暂不设置凭据',
    value: 'keep',
    disabled: false,
  },
  { label: '保存新凭据', value: 'replace', disabled: !protectionReady.value },
  {
    label: '删除已保存的凭据',
    value: 'remove',
    disabled: !current.value?.credentialConfigured,
  },
])

function accept(room: ManagementRoom) {
  current.value = room
  name.value = room.name
  guildId.value = room.guildId ?? ''
  voiceChannelId.value = room.voiceChannelId ?? ''
  captureMode.value = room.captureMode
  commanderText.value = room.commanderIds.join('\n')
  credentialAction.value = 'keep'
  credential.value = ''
}

async function load() {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = managementRoomResponseSchema.parse(
      await $fetch('/api/management/room'),
    )
    if (!disposed) {
      accept(result.room)
      protectionReady.value = result.credentialProtectionReady
    }
  } catch (failure) {
    if (!disposed) {
      error.value = managementFailure(failure)
    }
  } finally {
    busy.value = false
  }
}

async function save() {
  if (!current.value || busy.value) {
    return
  }
  notice.value = ''
  error.value = ''
  const input = roomUpdateSchema.safeParse({
    expectedVersion: current.value.version,
    name: name.value,
    guildId: guildId.value.trim() || null,
    voiceChannelId: voiceChannelId.value.trim() || null,
    captureMode: captureMode.value,
    commanderIds:
      captureMode.value === 'ALL_CHANNEL'
        ? []
        : commanderText.value.split(/[\s,，]+/).filter(Boolean),
    ...(credentialAction.value === 'replace' ? { credential: credential.value } : {}),
    removeCredential: credentialAction.value === 'remove',
  })
  if (!input.success) {
    error.value =
      '请填写房间名称；服务器和语音频道 ID 需同时填写，成员 ID 不可重复。新凭据不能包含空格。'
    return
  }
  busy.value = true
  try {
    const next = managementRoomSchema.parse(
      await $fetch('/api/management/room', { method: 'PATCH', body: input.data }),
    )
    if (!disposed) {
      accept(next)
      notice.value = '设置已保存。原声接入尚未完成，房间保持停止。'
    }
  } catch (failure) {
    if (!disposed) {
      error.value = managementFailure(failure)
    }
  } finally {
    credential.value = ''
    busy.value = false
  }
}

async function stop() {
  if (!current.value || busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    const next = managementRoomSchema.parse(
      await $fetch('/api/management/room/stop', {
        method: 'POST',
        body: { expectedVersion: current.value.version },
      }),
    )
    if (!disposed) {
      accept(next)
      notice.value = '停止状态已保存。'
    }
  } catch (failure) {
    if (!disposed) {
      error.value = managementFailure(failure)
    }
  } finally {
    busy.value = false
  }
}

watch(credentialAction, () => {
  credential.value = ''
})
onMounted(load)
onBeforeUnmount(() => {
  disposed = true
  credential.value = ''
})
</script>

<template>
  <section
    class="management-section"
    aria-labelledby="room-settings-title"
    :aria-busy="busy"
  >
    <div class="section-heading">
      <h2 id="room-settings-title">房间与 Discord 来源</h2>
      <Tag
        v-if="current"
        :value="current.stopped ? '保持停止' : '运行中'"
        severity="secondary"
      />
    </div>
    <p class="muted">
      原声通道尚未接通。可以先保存设置，当前不会连接 Discord 或播放声音。
    </p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <form v-if="current" class="entry-form" @submit.prevent="save">
      <div class="field">
        <label for="room-name">房间名称</label>
        <InputText
          id="room-name"
          v-model="name"
          :disabled="busy"
          maxlength="80"
          required
        />
      </div>
      <div class="management-fields">
        <div class="field">
          <label for="discord-guild">Discord 服务器 ID</label>
          <InputText
            id="discord-guild"
            v-model="guildId"
            :disabled="busy"
            inputmode="numeric"
            autocomplete="off"
          />
        </div>
        <div class="field">
          <label for="discord-channel">语音频道 ID</label>
          <InputText
            id="discord-channel"
            v-model="voiceChannelId"
            :disabled="busy"
            inputmode="numeric"
            autocomplete="off"
          />
        </div>
      </div>
      <div class="field">
        <label for="capture-mode">收听范围</label>
        <Select
          input-id="capture-mode"
          v-model="captureMode"
          :options="captureModes"
          option-label="label"
          option-value="value"
          :disabled="busy"
          aria-describedby="capture-mode-help"
        />
        <small id="capture-mode-help" class="muted">{{
          captureMode === 'ALL_CHANNEL'
            ? '自动接收该频道的发言成员，按 Discord 用户区分音源，无需填写成员 ID。'
            : '只接收下方指定成员的语音。'
        }}</small>
      </div>
      <div v-if="captureMode === 'SELECTED_USERS'" class="field">
        <label for="commanders">成员 Discord 用户 ID</label>
        <Textarea
          id="commanders"
          v-model="commanderText"
          :disabled="busy"
          rows="3"
          aria-describedby="commanders-help"
        />
        <small id="commanders-help" class="muted"
          >每行一个 ID。只接收这些成员的语音。</small
        >
      </div>
      <div class="field">
        <label for="credential-action">机器人凭据</label>
        <Select
          input-id="credential-action"
          v-model="credentialAction"
          :options="credentialActions"
          option-label="label"
          option-value="value"
          option-disabled="disabled"
          :disabled="busy"
        />
        <small class="muted">{{
          current.credentialConfigured
            ? '凭据已保存，不会在页面回显。'
            : '尚未保存凭据。'
        }}</small>
        <p v-if="!protectionReady" class="muted">
          服务器尚未配置凭据保护，暂不能保存新凭据。
        </p>
      </div>
      <div v-if="credentialAction === 'replace'" class="field">
        <label for="discord-credential">新机器人 token</label>
        <InputText
          id="discord-credential"
          v-model="credential"
          type="password"
          autocomplete="new-password"
          :spellcheck="false"
          :disabled="busy"
          required
        />
      </div>
      <p v-if="credentialAction === 'remove'" class="form-error">
        保存后将删除机器人凭据，并保持房间停止。
      </p>
      <p class="muted">
        更换凭据、语音频道、收听范围或成员名单会停止当前来源，需要重新验证后才能启动。
      </p>
      <div class="management-actions">
        <Button type="submit" label="保存设置" :loading="busy" />
        <Button label="重新载入" severity="secondary" :disabled="busy" @click="load" />
        <Button
          label="停止房间"
          severity="danger"
          :disabled="busy || current.stopped"
          @click="stop"
        />
      </div>
      <small class="muted"
        >配置版本 {{ current.version }} · 重新载入会放弃本页未保存的修改。</small
      >
    </form>
    <Button
      v-else
      label="载入房间设置"
      severity="secondary"
      :loading="busy"
      @click="load"
    />
  </section>
</template>
