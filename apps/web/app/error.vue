<script setup lang="ts">
defineProps<{ error: { statusCode: number; message: string } }>()
</script>

<template>
  <main class="error-page">
    <p class="eyebrow">Babel · {{ error.statusCode }}</p>
    <h1>暂时无法打开此页面</h1>
    <p class="muted">
      {{
        error.statusCode === 404
          ? '页面不存在，请返回收听室。'
          : '请检查服务配置，或通过 Access 入口重新登录管理页面。'
      }}
    </p>
    <a href="/">返回收听室</a>
  </main>
</template>
