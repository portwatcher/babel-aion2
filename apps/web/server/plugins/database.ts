import { closeDatabase } from '../utils/database'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('close', closeDatabase)
})
