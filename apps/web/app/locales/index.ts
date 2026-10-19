import en from './en.json'
import zh from './zh-CN.json'
import ja from './ja.json'
import ko from './ko.json'
import type { InterfaceLocale } from '../utils/interface-locale'

export type InterfaceMessageKey = keyof typeof en
type Messages = Record<InterfaceMessageKey, string>
export const interfaceMessages = {
  en,
  'zh-CN': zh,
  ja,
  ko,
} satisfies Record<InterfaceLocale, Messages>
