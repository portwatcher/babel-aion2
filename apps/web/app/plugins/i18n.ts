import { createI18n } from 'vue-i18n'
import { interfaceMessages } from '~/locales'
import {
  browserInterfaceLocale,
  interfaceLocaleKey,
  isAdministratorInterface,
  requestInterfaceLocale,
  toInterfaceLocale,
  type InterfaceLocale,
} from '~/utils/interface-locale'

export default defineNuxtPlugin((nuxtApp) => {
  const route = useRoute()
  const requestUrl = useRequestURL()
  // Nuxt's error renderer uses an internal request URL; SSR context retains
  // the original page URL, which is also the browser's location on hydration.
  const requestedPath: string =
    (import.meta.server
      ? (nuxtApp.ssrContext?.url ?? requestUrl.pathname)
      : window.location.pathname
    ).split(/[?#]/)[0] ?? '/'
  const pageError = useError()
  const cookie = useCookie<string | null>(interfaceLocaleKey, {
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
    sameSite: 'lax',
  })
  const headers = import.meta.server ? useRequestHeaders(['accept-language']) : {}
  const preferred = useState<InterfaceLocale>(interfaceLocaleKey, () => {
    return (
      toInterfaceLocale(cookie.value) ??
      (import.meta.server
        ? requestInterfaceLocale(headers['accept-language'])
        : browserInterfaceLocale(
            navigator.languages?.length ? navigator.languages : [navigator.language],
          ))
    )
  })
  const administrator = computed<boolean>(() =>
    isAdministratorInterface(pageError.value ? requestedPath : route.path),
  )
  const locale = computed<InterfaceLocale>(() =>
    administrator.value ? 'en' : preferred.value,
  )
  // An instance belongs to one Nuxt application/request; never share locale state.
  const i18n = createI18n({
    legacy: false,
    locale: locale.value,
    fallbackLocale: 'en',
    messages: interfaceMessages,
  })
  nuxtApp.vueApp.use(i18n)
  watch(
    locale,
    (value) => {
      i18n.global.locale.value = value
    },
    { flush: 'sync' },
  )
  useHead(() => ({
    htmlAttrs: { lang: locale.value },
    title: administrator.value ? 'Administration · Babel' : i18n.global.t('siteTitle'),
    meta: [
      {
        name: 'description',
        content: administrator.value
          ? 'Babel administration.'
          : i18n.global.t('siteDescription'),
      },
    ],
  }))

  function select(value: unknown) {
    const next = toInterfaceLocale(value)
    if (!next) {
      return
    }
    preferred.value = next
    cookie.value = next
    try {
      localStorage.setItem(interfaceLocaleKey, next)
    } catch {
      // The current choice and SSR cookie still work when storage is unavailable.
    }
  }
  nuxtApp.hook('app:mounted', () => {
    try {
      const stored = toInterfaceLocale(localStorage.getItem(interfaceLocaleKey))
      if (stored) {
        select(stored)
      }
    } catch {
      // Hydrate the server-selected locale before consulting browser-only storage.
    }
  })

  return { provide: { interfaceLocale: { locale, administrator, select } } }
})
