import { usePrimeVue } from 'primevue/config'
import { interfaceMessages } from '~/locales'

export function useInterfaceControlLocale() {
  const { locale } = useNuxtApp().$interfaceLocale
  const primevue = usePrimeVue()
  watchEffect(() => {
    const messages = interfaceMessages[locale.value]
    if (primevue.config.locale) {
      Object.assign(primevue.config.locale, {
        emptyMessage: messages.selectEmpty,
        emptySearchMessage: messages.selectEmpty,
        searchMessage: messages.selectResults,
        selectionMessage: messages.selectSelected,
        emptySelectionMessage: messages.selectNone,
      })
    }
  })
}
