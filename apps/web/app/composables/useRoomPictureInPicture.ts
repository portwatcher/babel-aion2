import type { PipDimensions } from '~/utils/pip-layout'

interface DocumentPictureInPictureApi {
  requestWindow(options: PipDimensions): Promise<Window>
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPictureApi
  }
}

function readStyleText(node: HTMLStyleElement): string {
  if (node.textContent) {
    return node.textContent
  }
  try {
    if (node.sheet?.cssRules.length) {
      return [...node.sheet.cssRules].map((rule) => rule.cssText).join('\n')
    }
  } catch {
    // Ignore inaccessible cross-origin sheets.
  }
  return ''
}

function syncDocumentStyles(target: Document): () => void {
  const mirrored = new Map<Node, HTMLElement>()

  function createMirror(node: Node): HTMLElement | null {
    if (node instanceof HTMLLinkElement && node.rel === 'stylesheet' && node.href) {
      const link = target.createElement('link')
      link.rel = 'stylesheet'
      link.href = node.href
      return link
    }
    if (node instanceof HTMLStyleElement) {
      const style = target.createElement('style')
      style.textContent = readStyleText(node)
      return style
    }
    return null
  }

  function syncNode(node: Node) {
    const existing = mirrored.get(node)
    if (node instanceof HTMLStyleElement && existing) {
      existing.textContent = readStyleText(node)
      return
    }
    if (existing) {
      return
    }
    const clone = createMirror(node)
    if (clone) {
      mirrored.set(node, clone)
      target.head.append(clone)
    }
  }

  for (const child of document.head.childNodes) {
    syncNode(child)
  }
  for (const sheet of document.adoptedStyleSheets ?? []) {
    try {
      const style = target.createElement('style')
      style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join('\n')
      target.head.append(style)
    } catch {
      // Ignore unreadable sheets.
    }
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') {
        for (const removed of record.removedNodes) {
          const clone = mirrored.get(removed)
          if (clone) {
            clone.remove()
            mirrored.delete(removed)
          }
        }
        for (const added of record.addedNodes) {
          syncNode(added)
        }
        if (record.target instanceof HTMLStyleElement) {
          syncNode(record.target)
        }
      } else if (record.type === 'characterData') {
        const parent = record.target.parentNode
        if (parent instanceof HTMLStyleElement) {
          syncNode(parent)
        }
      }
    }
  })
  observer.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  })
  return () => {
    observer.disconnect()
    mirrored.clear()
  }
}

export function useRoomPictureInPicture(sessionKey: () => string) {
  const { t, locale } = useInterfaceLocale()
  const supported = ref(false)
  const opening = ref(false)
  const target = shallowRef<HTMLElement | null>(null)
  const pipWindow = shallowRef<Window | null>(null)
  const failed = ref(false)
  let pip: Window | null = null
  let stopStyleSync: (() => void) | null = null
  let generation = 0
  let disposed = false

  function cleanupStyles() {
    stopStyleSync?.()
    stopStyleSync = null
  }

  function close() {
    generation += 1
    const previous = pip
    pip = null
    pipWindow.value = null
    target.value = null
    opening.value = false
    cleanupStyles()
    previous?.close()
  }

  function resize(dimensions: PipDimensions) {
    if (!pip || pip.closed) {
      return
    }
    try {
      pip.resizeTo(dimensions.width, dimensions.height)
    } catch {
      // Some window managers or browsers restrict programmatic resizing.
    }
  }

  async function open(dimensions: PipDimensions = { width: 520, height: 560 }) {
    if (opening.value || pip || disposed || !supported.value) {
      return
    }
    const api = window.documentPictureInPicture
    if (!api) {
      return
    }
    const requestedGeneration = ++generation
    opening.value = true
    failed.value = false
    let opened: Window | undefined
    try {
      // Invoke directly from the click; awaiting other work first loses activation.
      opened = await api.requestWindow(dimensions)
      if (disposed || generation !== requestedGeneration) {
        opened.close()
        return
      }
      pip = opened
      pipWindow.value = opened
      const page = opened.document
      page.title = t('pipTitle')
      page.documentElement.lang = document.documentElement.lang
      page.documentElement.className = document.documentElement.className
      page.body.className = 'room-pip-page'
      cleanupStyles()
      stopStyleSync = syncDocumentStyles(page)
      const mount = page.createElement('main')
      mount.className = 'room-pip-root'
      mount.setAttribute('aria-label', t('pipTitle'))
      page.body.append(mount)
      target.value = mount
      const currentWindow = opened
      opened.addEventListener(
        'pagehide',
        () => {
          if (pip === currentWindow) {
            pip = null
            pipWindow.value = null
            target.value = null
            cleanupStyles()
          }
        },
        { once: true },
      )
    } catch {
      opened?.close()
      if (!disposed && generation === requestedGeneration) {
        pip = null
        pipWindow.value = null
        target.value = null
        cleanupStyles()
        failed.value = true
      }
    } finally {
      if (generation === requestedGeneration) {
        opening.value = false
      }
    }
  }

  watch(locale, () => {
    if (pip) {
      pip.document.title = t('pipTitle')
      pip.document.documentElement.lang = locale.value
      target.value?.setAttribute('aria-label', t('pipTitle'))
    }
  })
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

  return {
    supported,
    opening,
    target,
    window: pipWindow,
    error: computed(() => (failed.value ? t('pipFailed') : '')),
    open,
    close,
    resize,
  }
}
