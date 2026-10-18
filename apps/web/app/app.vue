<template>
  <a class="skip-link" href="#main">跳转到主要内容</a>
  <div class="site-shell">
    <header class="site-header">
      <NuxtLink to="/" class="site-title" aria-label="Babel 首页">Babel</NuxtLink>
      <span class="site-context">AION2 · Global / Asia</span>
      <nav aria-label="主要导航">
        <a href="/admin">管理</a>
      </nav>
    </header>
    <NuxtPage />
    <footer class="site-footer">原声指挥 · 多语言字幕</footer>
  </div>
</template>
