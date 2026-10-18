import { createHash } from 'node:crypto'

export async function storageDigest(client, { excludeTables = [] } = {}) {
  const tables = (
    await client.query(
      "select schemaname, tablename from pg_tables where schemaname in ('public','drizzle') order by schemaname, tablename",
    )
  ).rows
  const result = {}
  const quoted = (value) => '"' + value.replaceAll('"', '""') + '"'
  for (const table of tables) {
    if (excludeTables.includes(`${table.schemaname}.${table.tablename}`)) {
      continue
    }
    const name = `${quoted(table.schemaname)}.${quoted(table.tablename)}`
    const rows = (
      await client.query(
        `select to_jsonb(t)::text as data from ${name} t order by data`,
      )
    ).rows
    result[name] = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  }
  return result
}
