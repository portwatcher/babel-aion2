import type { AdministratorIdentity } from '@babel/auth/access'

declare module 'h3' {
  interface H3EventContext {
    administrator?: AdministratorIdentity
  }
}

export {}
