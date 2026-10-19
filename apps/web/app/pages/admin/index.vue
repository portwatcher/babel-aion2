<script setup lang="ts">
import { DEFAULT_ROOM_ID, type ProviderSummary } from '@babel/contracts'

definePageMeta({
  middleware: 'administrator',
  key: (route) => String(route.query.roomId ?? 'default'),
})
const route = useRoute()
const { data: directory, refresh: refreshDirectory } =
  await useFetch('/api/player/rooms')
const selectedRoomId = computed(() =>
  typeof route.query.roomId === 'string' ? route.query.roomId : null,
)
const roomChoices = computed(() => [
  { id: null, name: '原有指挥室' },
  ...(directory.value?.rooms ?? []).filter((room) => room.id !== DEFAULT_ROOM_ID),
])
async function selectRoom(id: string | null) {
  await navigateTo({ path: '/admin', query: id ? { roomId: id } : {} })
}
useHead({ title: '管理 · Babel' })
const { status, loading, error, connect } = useAdministratorStatus()
const terminologyVersion = ref<number | null>(null)
const providers = shallowRef<ProviderSummary[]>([])
</script>

<template>
  <main id="main" tabindex="-1" class="main-content">
    <div class="page-heading">
      <p class="eyebrow">管理员</p>
      <h1>指挥室管理</h1>
      <p class="muted">{{ status?.administrator.email ?? '正在建立管理会话…' }}</p>
    </div>
    <section v-if="error" class="empty-state" aria-live="polite">
      <h2>管理会话未建立</h2>
      <p>{{ error }}</p>
      <Button label="重试" severity="secondary" :loading="loading" @click="connect" />
    </section>
    <template v-else-if="status">
      <div class="field management-section">
        <label for="management-room">管理房间</label>
        <Select
          input-id="management-room"
          :model-value="selectedRoomId"
          :options="roomChoices"
          option-label="name"
          option-value="id"
          @update:model-value="selectRoom"
        />
      </div>
      <AdminRoomSettings />
      <AdminRoomAdmission @published="refreshDirectory" />
      <AdminListeners />
      <AdminProviders
        :terminology-version="terminologyVersion"
        @change="providers = $event"
      />
      <AdminLanguages
        :providers="providers"
        :terminology-version="terminologyVersion"
      />
      <AdminTerms @version="terminologyVersion = $event" />
      <section
        class="room-detail"
        :aria-busy="loading"
        aria-labelledby="services-title"
      >
        <h2 id="services-title">服务接入</h2>
        <p class="muted">原声连接状态显示在房间设置中。字幕服务需分别配置和验证。</p>
        <dl class="service-list">
          <div>
            <dt>Discord 指挥原声</dt>
            <dd>由房间来源控制</dd>
          </div>
          <div>
            <dt>玩家音频分发</dt>
            <dd>通过收听通道分发</dd>
          </div>
          <div>
            <dt>识别与翻译服务</dt>
            <dd>
              {{
                status.services.subtitles === 'READY'
                  ? '字幕处理可用'
                  : '字幕工作进程暂不可用'
              }}
            </dd>
          </div>
          <div>
            <dt>字幕语言</dt>
            <dd>由输出语言设置控制</dd>
          </div>
        </dl>
      </section>
    </template>
  </main>
</template>
