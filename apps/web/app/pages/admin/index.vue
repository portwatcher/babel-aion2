<script setup lang="ts">
import type { ProviderSummary } from '@babel/contracts'

definePageMeta({ middleware: 'administrator' })
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
      <AdminRoomSettings />
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
        <p class="muted">以下服务尚未接通。保存房间设置不会启用这些通道。</p>
        <dl class="service-list">
          <div>
            <dt>Discord 指挥原声</dt>
            <dd>尚未接入</dd>
          </div>
          <div>
            <dt>玩家音频分发</dt>
            <dd>尚未接入</dd>
          </div>
          <div>
            <dt>识别与翻译服务</dt>
            <dd>尚未接入</dd>
          </div>
          <div>
            <dt>字幕语言</dt>
            <dd>尚未开放</dd>
          </div>
        </dl>
      </section>
    </template>
  </main>
</template>
