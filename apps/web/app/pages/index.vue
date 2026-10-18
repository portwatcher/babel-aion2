<script setup lang="ts">
const { data: configuration, error, refresh } = await useFetch('/api/player/config')
</script>

<template>
  <main id="main" tabindex="-1" class="main-content">
    <div class="page-heading">
      <p class="eyebrow">指挥收听室</p>
      <h1>{{ configuration?.room.name ?? 'AION2 深渊站' }}</h1>
      <p class="muted">听见原声，跟上每一道指令。</p>
    </div>
    <section v-if="error" class="empty-state" aria-live="polite">
      <h2>暂时无法获取房间状态</h2>
      <p>请检查网络连接，然后重试。</p>
      <Button label="重新加载" severity="secondary" @click="refresh()" />
    </section>
    <div v-else-if="configuration" class="room-layout">
      <RoomEntry :configuration="configuration" />
      <section class="room-detail" aria-labelledby="room-status-title">
        <div class="section-heading">
          <h2 id="room-status-title">频道状态</h2>
          <Tag value="等待接入" severity="secondary" />
        </div>
        <p class="muted">指挥语音频道尚未接入。接通后，你可以在这里进入收听。</p>
        <div class="detail-divider" />
        <h2>在线名单</h2>
        <p class="muted">开放收听后，这里会显示当前收听连接的昵称和状态。</p>
      </section>
    </div>
  </main>
</template>
