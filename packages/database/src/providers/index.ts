import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, or, sql } from 'drizzle-orm'
import {
  providerSaveSchema,
  type ProviderSave,
  type ProviderTestResult,
  type ProviderSampleResult,
} from '@babel/contracts'
import type { Database } from '../client.ts'
import type { CredentialCipher } from '../credentials.ts'
import { CredentialProtectionError } from '../credentials.ts'
import {
  auditEvent,
  outputLanguage,
  providerConfiguration,
  providerRevision,
} from '../schema/rooms.ts'
import {
  ProviderConfigurationError,
  providerSummary,
  settingsOf,
  type ConnectionProbe,
  type StoredProvider,
  type ProtectedProvider,
} from './model.ts'
import { termCatalog } from '../schema/terms.ts'

export { ProviderConfigurationError } from './model.ts'

export function createProviderService(
  db: Database,
  cipher: CredentialCipher | null,
  probe: ConnectionProbe,
) {
  const context = (id: string) => `provider:${id}:credential`
  function protection() {
    if (!cipher) {
      throw new CredentialProtectionError()
    }
    return cipher
  }
  async function stored(id: string) {
    const [row] = await db
      .select()
      .from(providerConfiguration)
      .where(eq(providerConfiguration.id, id))
    return row
  }
  function expected(row: StoredProvider | undefined, version: number) {
    if (!row) {
      throw new ProviderConfigurationError('NOT_FOUND')
    }
    if (row.version !== version) {
      throw new ProviderConfigurationError('VERSION_CONFLICT')
    }
    return row
  }
  async function read(id: string) {
    const row = await stored(id)
    if (!row) {
      throw new ProviderConfigurationError('NOT_FOUND')
    }
    const history = await db
      .select({
        version: providerRevision.version,
        name: providerRevision.name,
        createdAt: providerRevision.createdAt,
      })
      .from(providerRevision)
      .where(eq(providerRevision.configurationId, id))
      .orderBy(desc(providerRevision.version))
      .limit(20)
    return providerSummary(
      row,
      history.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    )
  }
  async function acquireTest(id: string, version: number) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(providerConfiguration)
        .where(eq(providerConfiguration.id, id))
        .for('update')
      const current = expected(row, version)
      const now = Date.now()
      if (current.testLeaseUntil && current.testLeaseUntil.getTime() > now) {
        throw new ProviderConfigurationError('TEST_IN_PROGRESS')
      }
      if (
        current.lastTestStartedAt &&
        now - current.lastTestStartedAt.getTime() < 10_000
      ) {
        throw new ProviderConfigurationError('TEST_COOLDOWN')
      }
      const leaseId = randomUUID()
      await tx
        .update(providerConfiguration)
        .set({
          testLeaseId: leaseId,
          testLeaseUntil: new Date(now + 35_000),
          lastTestStartedAt: new Date(now),
        })
        .where(eq(providerConfiguration.id, id))
      return leaseId
    })
  }
  async function releaseTest(id: string, leaseId: string) {
    await db
      .update(providerConfiguration)
      .set({ testLeaseId: null, testLeaseUntil: null })
      .where(
        and(
          eq(providerConfiguration.id, id),
          eq(providerConfiguration.testLeaseId, leaseId),
        ),
      )
  }
  async function auditTest(
    id: string,
    actor: string,
    version: number,
    result: ProviderTestResult,
    scope: string,
  ) {
    await db.insert(auditEvent).values({
      actorSubject: actor,
      action: 'provider.test',
      resourceId: id,
      metadata: { version, code: result.code, scope },
    })
  }
  async function test(id: string, version: number, actor: string) {
    const current = expected(await stored(id), version)
    const credential = protection().decrypt(current.encryptedCredential, context(id))
    const settings = settingsOf(current)
    const leaseId = await acquireTest(id, version)
    try {
      const result = {
        ...(await probe(settings, credential)),
        configurationVersion: version,
      }
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(providerConfiguration)
          .where(eq(providerConfiguration.id, id))
          .for('update')
        const fresh = expected(row, version)
        if (fresh.testLeaseId !== leaseId) {
          throw new ProviderConfigurationError('VERSION_CONFLICT')
        }
        await tx
          .update(providerConfiguration)
          .set({ lastTest: result, testLeaseId: null, testLeaseUntil: null })
          .where(eq(providerConfiguration.id, id))
        await tx.insert(auditEvent).values({
          actorSubject: actor,
          action: 'provider.test',
          resourceId: id,
          metadata: { version, code: result.code, scope: 'saved' },
        })
      })
      return read(id)
    } finally {
      await releaseTest(id, leaseId)
    }
  }
  async function save(id: string, update: ProviderSave, actor: string) {
    const input = providerSaveSchema.safeParse(update)
    if (!input.success) {
      throw new ProviderConfigurationError('INVALID_CONFIGURATION')
    }
    const data = input.data
    const current = await stored(id)
    if (data.expectedVersion === 0 && current) {
      throw new ProviderConfigurationError('VERSION_CONFLICT')
    }
    if (data.expectedVersion > 0) {
      expected(current, data.expectedVersion)
    }
    if (current && current.providerType !== data.settings.type) {
      throw new ProviderConfigurationError('TYPE_IMMUTABLE')
    }
    if (!current && !data.credential) {
      throw new ProviderConfigurationError('INVALID_CONFIGURATION')
    }
    const credential =
      data.credential ??
      (current ? protection().decrypt(current.encryptedCredential, context(id)) : '')
    const encryptedCredential = data.credential
      ? protection().encrypt(credential, context(id))
      : current?.encryptedCredential
    if (!encryptedCredential) {
      throw new ProviderConfigurationError('INVALID_CONFIGURATION')
    }
    const changed = Boolean(
      current &&
      (data.credential ||
        JSON.stringify(settingsOf(current)) !== JSON.stringify(data.settings)),
    )
    let leaseId: string | undefined
    let result: ProviderTestResult | null = null
    try {
      if (changed) {
        leaseId = await acquireTest(id, data.expectedVersion)
        result = {
          ...(await probe(data.settings, credential)),
          configurationVersion: data.expectedVersion + 1,
        }
        await auditTest(id, actor, data.expectedVersion, result, 'candidate')
        if (result.code !== 'PASS') {
          throw new ProviderConfigurationError('CONNECTION_TEST_FAILED', result.code)
        }
      }
      await db.transaction(async (tx) => {
        // Serialize creation as well as updates without a per-process lock.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${'babel:provider:' + id}, 0))`,
        )
        const [row] = await tx
          .select()
          .from(providerConfiguration)
          .where(eq(providerConfiguration.id, id))
          .for('update')
        if (data.expectedVersion === 0 && row) {
          throw new ProviderConfigurationError('VERSION_CONFLICT')
        }
        if (data.expectedVersion > 0) {
          expected(row, data.expectedVersion)
        }
        if (leaseId && row?.testLeaseId !== leaseId) {
          throw new ProviderConfigurationError('VERSION_CONFLICT')
        }
        if (
          row?.testLeaseUntil &&
          row.testLeaseUntil.getTime() > Date.now() &&
          row.testLeaseId !== leaseId
        ) {
          throw new ProviderConfigurationError('TEST_IN_PROGRESS')
        }
        if (row) {
          await tx.insert(providerRevision).values({
            configurationId: id,
            version: row.version,
            name: row.name,
            settings: row.publicSettings,
            encryptedCredential: row.encryptedCredential,
          })
        }
        const version = data.expectedVersion + 1
        const carriedTest = row?.lastTest
          ? { ...row.lastTest, configurationVersion: version }
          : null
        const values = {
          name: data.name,
          providerType: data.settings.type,
          purpose:
            data.settings.type === 'soniox' ? 'speech_recognition' : 'text_translation',
          publicSettings: data.settings,
          encryptedCredential,
          version,
          lastTest: changed ? result : carriedTest,
          enabled: false,
          testLeaseId: null,
          testLeaseUntil: null,
          updatedAt: new Date(),
        }
        if (row) {
          await tx
            .update(providerConfiguration)
            .set(values)
            .where(eq(providerConfiguration.id, id))
        } else {
          await tx.insert(providerConfiguration).values({ id, ...values })
        }
        await tx.insert(auditEvent).values({
          actorSubject: actor,
          action: 'provider.save',
          resourceId: id,
          metadata: { version, credentialChanged: Boolean(data.credential) },
        })
      })
      return read(id)
    } finally {
      if (leaseId) {
        await releaseTest(id, leaseId)
      }
    }
  }
  async function restore(
    id: string,
    version: number,
    restoreVersion: number,
    actor: string,
  ) {
    expected(await stored(id), version)
    const [previous] = await db
      .select()
      .from(providerRevision)
      .where(
        and(
          eq(providerRevision.configurationId, id),
          eq(providerRevision.version, restoreVersion),
        ),
      )
    if (!previous) {
      throw new ProviderConfigurationError('NOT_FOUND')
    }
    const credential = protection().decrypt(previous.encryptedCredential, context(id))
    const settings = settingsOf({
      ...expected(await stored(id), version),
      publicSettings: previous.settings,
    })
    return save(
      id,
      { expectedVersion: version, name: previous.name, settings, credential },
      actor,
    )
  }
  async function remove(id: string, version: number, actor: string) {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(providerConfiguration)
        .where(eq(providerConfiguration.id, id))
        .for('update')
      expected(row, version)
      if (row?.testLeaseUntil && row.testLeaseUntil.getTime() > Date.now()) {
        throw new ProviderConfigurationError('TEST_IN_PROGRESS')
      }
      const [used] = await tx
        .select({ code: outputLanguage.code })
        .from(outputLanguage)
        .where(
          or(
            eq(outputLanguage.recognitionConfigurationId, id),
            eq(outputLanguage.translationConfigurationId, id),
          ),
        )
        .limit(1)
      if (used) {
        throw new ProviderConfigurationError('PROVIDER_IN_USE')
      }
      await tx.delete(providerConfiguration).where(eq(providerConfiguration.id, id))
      await tx.insert(auditEvent).values({
        actorSubject: actor,
        action: 'provider.remove',
        resourceId: id,
        metadata: { version },
      })
    })
  }
  async function sample(
    references: Array<{ id: string; version: number }>,
    actor: string,
    operation: (providers: ProtectedProvider[]) => Promise<ProviderSampleResult>,
  ) {
    const leased: Array<{ id: string; version: number; leaseId: string }> = []
    const providers: ProtectedProvider[] = []
    try {
      // A sample holds the same test slots as ordinary connection tests. The
      // 30-second sample deadline fits inside their 35-second database lease.
      for (const reference of [...references].sort((a, b) =>
        a.id.localeCompare(b.id),
      )) {
        const row = expected(await stored(reference.id), reference.version)
        const credential = protection().decrypt(
          row.encryptedCredential,
          context(row.id),
        )
        providers.push({
          id: row.id,
          version: row.version,
          settings: settingsOf(row),
          credential,
        })
      }
      if (
        providers.length !== 2 ||
        new Set(providers.map((value) => value.settings.type)).size !== 2
      ) {
        throw new ProviderConfigurationError('INVALID_CONFIGURATION')
      }
      for (const provider of providers) {
        const leaseId = await acquireTest(provider.id, provider.version)
        leased.push({ id: provider.id, version: provider.version, leaseId })
      }
      const result = await operation(providers)
      await db.transaction(async (tx) => {
        for (const lease of leased) {
          const [row] = await tx
            .select()
            .from(providerConfiguration)
            .where(eq(providerConfiguration.id, lease.id))
            .for('update')
          const fresh = expected(row, lease.version)
          if (fresh.testLeaseId !== lease.leaseId) {
            throw new ProviderConfigurationError('VERSION_CONFLICT')
          }
        }
        if (result.terminology) {
          const [catalog] = await tx
            .select()
            .from(termCatalog)
            .where(eq(termCatalog.id, 'global'))
            .for('share')
          if (!catalog || catalog.version !== result.terminology.version) {
            throw new ProviderConfigurationError('TERMINOLOGY_CHANGED')
          }
        }
        await tx.insert(auditEvent).values({
          actorSubject: actor,
          action: 'provider.sample',
          metadata: {
            configurations: leased.map(({ id, version }) => ({ id, version })),
            code: result.code,
            terminologyVersion: result.terminology?.version ?? null,
          },
        })
      })
      return result
    } finally {
      await Promise.all(leased.map((lease) => releaseTest(lease.id, lease.leaseId)))
    }
  }
  return {
    read,
    save,
    test,
    restore,
    remove,
    sample,
    async list() {
      const rows = await db
        .select({ id: providerConfiguration.id })
        .from(providerConfiguration)
        .orderBy(asc(providerConfiguration.name), asc(providerConfiguration.id))
      return Promise.all(rows.map((row) => read(row.id)))
    },
  }
}
