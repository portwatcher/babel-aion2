interface SubtitlePictureInPictureApi {
  requestWindow(options: { width: number; height: number }): Promise<Window>
}

declare global {
  interface Window {
    documentPictureInPicture?: SubtitlePictureInPictureApi
  }
}

function copyPageStyles(target: Document) {
  for (const sheet of document.styleSheets) {
    try {
      const style = target.createElement('style')
      style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join('\n')
      target.head.append(style)
    } catch {
      if (sheet.href) {
        const link = target.createElement('link')
        link.rel = 'stylesheet'
        link.href = sheet.href
        target.head.append(link)
      }
    }
  }
}

export function useSubtitlePictureInPicture(sessionKey: () => string) {
  const supported = ref(false)
  const opening = ref(false)
  const target = shallowRef<HTMLElement | null>(null)
  const error = ref('')
  let pip: Window | null = null
  let generation = 0
  let disposed = false

  function close() {
    generation += 1
    const previous = pip
    pip = null
    target.value = null
    opening.value = false
    previous?.close()
  }

  async function open() {
    if (opening.value || pip || disposed || !supported.value) {
      return
    }
    const api = window.documentPictureInPicture
    if (!api) {
      return
    }
    const requestedGeneration = ++generation
    opening.value = true
    error.value = ''
    let opened: Window | undefined
    try {
      // Invoke directly from the click; awaiting other work first loses activation.
      opened = await api.requestWindow({ width: 560, height: 200 })
      if (disposed || generation !== requestedGeneration) {
        opened.close()
        return
      }
      pip = opened
      const page = opened.document
      page.title = 'Babel · 指挥字幕'
      page.documentElement.lang = document.documentElement.lang
      page.documentElement.className = document.documentElement.className
      page.body.className = 'subtitle-pip-page'
      copyPageStyles(page)
      const mount = page.createElement('main')
      mount.setAttribute('aria-label', '指挥字幕')
      page.body.append(mount)
      target.value = mount
      const currentWindow = opened
      opened.addEventListener(
        'pagehide',
        () => {
          if (pip === currentWindow) {
            pip = null
            target.value = null
          }
        },
        { once: true },
      )
    } catch {
      opened?.close()
      if (!disposed && generation === requestedGeneration) {
        pip = null
        target.value = null
        error.value = '未能打开字幕小窗，请再次点击。也可以继续使用本页。'
      }
    } finally {
      if (generation === requestedGeneration) {
        opening.value = false
      }
    }
  }

  watch(sessionKey, close, { flush: 'sync' })
  onMounted(() => {
    supported.value =
      window.isSecureContext &&
      window.top === window &&
      typeof window.documentPictureInPicture?.requestWindow === 'function'
    window.addEventListener('pagehide', close)
  })
  onBeforeUnmount(() => {
    disposed = true
    close()
    window.removeEventListener('pagehide', close)
  })

  return { supported, opening, target, error, open, close }
}
