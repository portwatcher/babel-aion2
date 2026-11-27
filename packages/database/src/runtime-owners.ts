import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { ListenerReference } from '@babel/contracts'
import type { Database } from './client.ts'
import { mediaConnection } from './schema/media-connections.ts'
import { runtimeOwner } from './schema/runtime-owners.ts'
import { runtimePod } from './schema/runtime-pods.ts'
import { closeRuntimeOwner, RuntimeOwnerUnavailable } from './runtime-owner-closure.ts'
import { registerPodRuntime, type RuntimePodIdentity } from './runtime-pods.ts'

export { RuntimeOwnerUnavailable } from './runtime-owner-closure.ts'

export interface ActiveVoiceWorker {
  ownerId: string
  controlUrl: string
  activeConnections: number
  fanoutOnly: boolean
}

export interface VoiceScaleLoad {
  activeSessions: number
  openMediaConnections: number
  activeVoiceSources: number
  activeFanoutWorkers: number
}

export async function registerRuntimeOwner(
  db: Database,
  id: string,
  pod?: RuntimePodIdentity,
) {
  if (pod) {
    return registerPodRuntime(db, id, pod)
  }
  await db.insert(runtimeOwner).values({ id }).onConflictDoNothing()
  const [owner] = await db.select().from(runtimeOwner).where(eq(runtimeOwner.id, id))
  if (!owner || owner.exitedAt || owner.podUid !== null) {
    throw new RuntimeOwnerUnavailable()
  }
}

export async function setRuntimeOwnerControlUrl(
  db: Pick<Database, 'update'>,
  id: string,
  controlUrl: string,
  options: { fanoutOnly?: boolean } = {},
) {
  const updated = await db
    .update(runtimeOwner)
    .set({ controlUrl, fanoutOnly: options.fanoutOnly === true })
    .where(and(eq(runtimeOwner.id, id), isNull(runtimeOwner.exitedAt)))
    .returning({ id: runtimeOwner.id })
  if (!updated.length) {
    throw new RuntimeOwnerUnavailable()
  }
}

/** Live voice workers eligible for new listener media admissions, with load counts. */
export async function listActiveVoiceWorkers(
  db: Pick<Database, 'select'>,
): Promise<ActiveVoiceWorker[]> {
  const rows = await db
    .select({
      ownerId: runtimeOwner.id,
      controlUrl: runtimeOwner.controlUrl,
      fanoutOnly: runtimeOwner.fanoutOnly,
      activeConnections: sql<number>`count(${mediaConnection.id})::int`,
    })
    .from(runtimeOwner)
    .leftJoin(runtimePod, eq(runtimePod.uid, runtimeOwner.podUid))
    .leftJoin(
      mediaConnection,
      and(
        eq(mediaConnection.ownerId, runtimeOwner.id),
        isNull(mediaConnection.closedAt),
      ),
    )
    .where(
      and(
        isNull(runtimeOwner.exitedAt),
        isNotNull(runtimeOwner.controlUrl),
        isNull(runtimePod.retirementRequestedAt),
        isNull(runtimePod.retiredAt),
      ),
    )
    .groupBy(
      runtimeOwner.id,
      runtimeOwner.controlUrl,
      runtimeOwner.fanoutOnly,
      runtimeOwner.startedAt,
    )
    .orderBy(asc(runtimeOwner.startedAt), asc(runtimeOwner.id))
  return rows.flatMap((row) =>
    row.controlUrl
      ? [
          {
            ownerId: row.ownerId,
            controlUrl: row.controlUrl,
            activeConnections: Number(row.activeConnections ?? 0),
            fanoutOnly: Boolean(row.fanoutOnly),
          },
        ]
      : [],
  )
}

/** Lightweight single-query load snapshot for external autoscalers (KEDA). */
export async function readVoiceScaleLoad(
  db: Pick<Database, 'execute'>,
): Promise<VoiceScaleLoad> {
  const result = await db.execute<{
    active_sessions: number
    open_media_connections: number
    active_voice_sources: number
    active_fanout_workers: number
  }>(sql`
    select
      (
        select count(*)::int
        from listener_session ls
        inner join room r on r.id = ls.room_id
        where ls.state in ('JOINING', 'ACTIVE')
          and ls.revoked_at is null
          and r.disbanded_at is null
      ) as active_sessions,
      (
        select count(*)::int
        from media_connection mc
        inner join runtime_owner ro on ro.id = mc.owner_id
        where mc.closed_at is null
          and ro.exited_at is null
      ) as open_media_connections,
      (
        select count(*)::int
        from voice_source_run
        where closed_at is null
      ) as active_voice_sources,
      (
        select count(*)::int
        from runtime_owner ro
        left join runtime_pod rp on rp.uid = ro.pod_uid
        where ro.exited_at is null
          and ro.control_url is not null
          and ro.fanout_only = true
          and rp.retirement_requested_at is null
          and rp.retired_at is null
      ) as active_fanout_workers
  `)
  const row = result.rows[0]
  return {
    activeSessions: Number(row?.active_sessions ?? 0),
    openMediaConnections: Number(row?.open_media_connections ?? 0),
    activeVoiceSources: Number(row?.active_voice_sources ?? 0),
    activeFanoutWorkers: Number(row?.active_fanout_workers ?? 0),
  }
}

/** Exact worker URL that registered a media connection, if it is still live. */
export async function readMediaConnectionOwnerUrl(
  db: Pick<Database, 'select'>,
  connectionId: string,
) {
  const [row] = await db
    .select({
      ownerId: mediaConnection.ownerId,
      controlUrl: runtimeOwner.controlUrl,
      exitedAt: runtimeOwner.exitedAt,
    })
    .from(mediaConnection)
    .leftJoin(runtimeOwner, eq(runtimeOwner.id, mediaConnection.ownerId))
    .where(eq(mediaConnection.id, connectionId))
    .limit(1)
  if (!row) {
    return null
  }
  return {
    ownerId: row.ownerId,
    controlUrl: row.exitedAt ? null : (row.controlUrl ?? null),
  }
}

/** Distinct worker endpoints that still hold unclosed media peers for a session. */
export async function readOpenMediaConnectionOwnerUrls(
  db: Pick<Database, 'select'>,
  reference: ListenerReference,
) {
  const rows = await db
    .select({
      ownerId: mediaConnection.ownerId,
      controlUrl: runtimeOwner.controlUrl,
      exitedAt: runtimeOwner.exitedAt,
    })
    .from(mediaConnection)
    .leftJoin(runtimeOwner, eq(runtimeOwner.id, mediaConnection.ownerId))
    .where(
      and(
        eq(mediaConnection.sessionId, reference.sessionId),
        eq(mediaConnection.nicknameGeneration, reference.nicknameGeneration),
        isNull(mediaConnection.closedAt),
      ),
    )
  const owners = new Map<string, string | null>()
  for (const row of rows) {
    owners.set(row.ownerId, row.exitedAt ? null : (row.controlUrl ?? null))
  }
  return [...owners.entries()].map(([ownerId, controlUrl]) => ({ ownerId, controlUrl }))
}

export async function runtimeOwnerActive(db: Pick<Database, 'select'>, id: string) {
  const [owner] = await db.select().from(runtimeOwner).where(eq(runtimeOwner.id, id))
  return Boolean(owner && !owner.exitedAt)
}

export async function lockRuntimeOwner(tx: Pick<Database, 'select'>, id: string) {
  // Held by the registration transaction until commit. Concurrent admissions
  // may share this lock, but exit reconciliation must acquire its exclusive lock.
  const [owner] = await tx
    .select()
    .from(runtimeOwner)
    .where(eq(runtimeOwner.id, id))
    .for('share')
  if (!owner || owner.exitedAt) {
    throw new RuntimeOwnerUnavailable()
  }
}

export async function confirmRuntimeExit(db: Database, id: string) {
  // Only the supervisor that observes its own child's OS exit may call this.
  // Never infer exit from a PID lookup, lease, lost socket or wall-clock timeout.
  await db.transaction((tx) => closeRuntimeOwner(tx, id))
}
