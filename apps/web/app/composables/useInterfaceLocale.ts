import { useI18n } from 'vue-i18n'
import type { InterfaceMessageKey } from '~/locales'

export function useInterfaceLocale() {
  const { t } = useI18n({ useScope: 'global' })
  const state = useNuxtApp().$interfaceLocale
  return {
    ...state,
    t: (key: InterfaceMessageKey, parameters: Record<string, string | number> = {}) =>
      t(key, parameters),
  }
}
