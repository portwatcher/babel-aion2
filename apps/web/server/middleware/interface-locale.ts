export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/') && !event.path.startsWith('/_nuxt/')) {
    appendResponseHeader(event, 'Vary', 'Accept-Language, Cookie')
  }
})
