<script setup lang="ts">
import { ASIA_SERVERS, roomInstallSchema } from '@babel/contracts'

const route = useRoute()
const { data: directory } = await useFetch('/api/player/rooms')
const name = ref('')
const server = ref<string | null>(null)
const allowed = ref('')
const voiceChannelId = ref<string | null>(null)
const installation = shallowRef<{
  name: string
  server: string
  allowedIds: string[]
  roomId: string | null
  channels: { id: string; name: string }[]
} | null>(null)
const busy = ref(false)
const error = ref(
  route.query.installationError ? 'Discord 安装未完成或已过期，请重新安装。' : '',
)

function feedback(failure: unknown) {
  if (failure && typeof failure === 'object' && 'data' in failure) {
    const data = failure.data
    if (
      data &&
      typeof data === 'object' &&
      'statusMessage' in data &&
      typeof data.statusMessage === 'string'
    ) {
      return data.statusMessage
    }
  }
  return '暂时无法完成，请稍后重试。'
}
async function install() {
  const parsed = roomInstallSchema.safeParse({
    name: name.value,
    server: server.value,
    allowedIds: allowed.value
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
  })
  if (!parsed.success) {
    error.value = !server.value
      ? '请选择区服'
      : (parsed.error.issues[0]?.message ?? '请检查房间设置')
    return
  }
  busy.value = true
  error.value = ''
  try {
    const result = await $fetch('/api/player/rooms/install', {
      method: 'POST',
      body: parsed.data,
    })
    await navigateTo(result.url, { external: true })
  } catch (failure) {
    error.value = feedback(failure)
  } finally {
    busy.value = false
  }
}
async function readInstallation() {
  busy.value = true
  error.value = ''
  try {
    const result = await $fetch('/api/player/rooms/installation')
    if (result.roomId) {
      await navigateTo(`/rooms/${result.roomId}`)
      return
    }
    installation.value = result
  } catch (failure) {
    error.value = feedback(failure)
  } finally {
    busy.value = false
  }
}
async function create() {
  if (!voiceChannelId.value) {
    error.value = '请选择语音频道'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const result = await $fetch('/api/player/rooms', {
      method: 'POST',
      body: { voiceChannelId: voiceChannelId.value },
    })
    await navigateTo(`/rooms/${result.roomId}`)
  } catch (failure) {
    error.value = feedback(failure)
  } finally {
    busy.value = false
  }
}
onMounted(() => {
  if (route.query.installed) {
    void readInstallation()
  }
})
</script>

<template>
  <main id="main" tabindex="-1" class="main-content">
    <div class="page-heading">
      <NuxtLink to="/" class="muted">← 房间列表</NuxtLink>
      <p class="eyebrow">AION2 深渊战</p>
      <h1>创建转播房间</h1>
      <p class="muted">选好区服，安装 Bot，再选择要转播的 Discord 语音频道。</p>
    </div>
    <div class="room-layout">
      <section class="entry-panel">
        <form v-if="!installation" class="entry-form" @submit.prevent="install">
          <h2>房间设置</h2>
          <div class="field">
            <label for="room-name">房间名称</label>
            <InputText
              id="room-name"
              v-model="name"
              required
              maxlength="64"
              :disabled="busy"
              placeholder="为这场转播起个名字"
            />
          </div>
          <div class="field">
            <label for="room-server">区服 <span class="muted">（必选）</span></label>
            <Select
              input-id="room-server"
              v-model="server"
              :options="[...ASIA_SERVERS]"
              :disabled="busy"
              placeholder="选择 Asia 区服"
            />
          </div>
          <div class="field">
            <label for="allowed-ids"
              >允许加入的角色 ID <span class="muted">（可选）</span></label
            >
            <Textarea
              id="allowed-ids"
              v-model="allowed"
              :disabled="busy"
              rows="4"
              placeholder="留空：本区服所有角色可加入"
              aria-describedby="allowed-ids-help"
            />
            <small id="allowed-ids-help" class="muted"
              >每行一个 ID，区分大小写，最多 200
              个。加入时验证角色是否存在于所选区服。</small
            >
          </div>
          <p v-if="!directory?.creationAvailable" class="muted" role="status">
            Discord 房间创建尚未配置，请稍后再试。
          </p>
          <Button
            type="submit"
            label="安装 Discord Bot 并继续"
            :loading="busy"
            :disabled="!directory?.creationAvailable"
          />
        </form>
        <form v-else class="entry-form" @submit.prevent="create">
          <h2>选择转播频道</h2>
          <p>{{ installation.name }} · Asia / {{ installation.server }}</p>
          <p class="muted">
            {{
              installation.allowedIds.length
                ? `仅允许 ${installation.allowedIds.length} 个指定角色加入`
                : '本区服所有角色可加入'
            }}
          </p>
          <div class="field">
            <label for="voice-channel">Discord 语音频道</label>
            <Select
              input-id="voice-channel"
              v-model="voiceChannelId"
              :options="installation.channels"
              option-label="name"
              option-value="id"
              placeholder="选择语音频道"
              :disabled="busy"
            />
          </div>
          <p v-if="!installation.channels.length" class="muted">
            没有可用频道。请确认 Bot 可查看、连接并在目标语音频道发言，再刷新频道列表。
          </p>
          <Button
            label="刷新频道列表"
            severity="secondary"
            :disabled="busy"
            @click="readInstallation"
          />
          <Button
            type="submit"
            label="创建并进入房间"
            :loading="busy"
            :disabled="!voiceChannelId"
          />
        </form>
        <p v-if="error" class="form-error admission-notice" role="alert">{{ error }}</p>
        <Button
          v-if="route.query.installed && !installation"
          label="重新读取安装结果"
          severity="secondary"
          :loading="busy"
          @click="readInstallation"
        />
      </section>
      <aside class="room-detail" aria-label="创建说明">
        <h2>指挥与队伍，在这里汇合</h2>
        <p class="muted">
          安装会自动申请查看频道、连接语音和发言权限。你需要有 Discord
          服务器的管理权限。
        </p>
        <p class="muted">
          选定频道中的所有发言都会用于原声转播与字幕处理，请提前告知频道成员。
        </p>
        <p class="muted">
          一个 Discord
          服务器对应一个房间。成员加入后，可以在深渊地图上共同画线，每条线都带有游戏角色
          ID。
        </p>
        <p class="muted">角色查询只确认角色存在，不验证账号归属。</p>
      </aside>
    </div>
  </main>
</template>
