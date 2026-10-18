# Deployment handoff

Target: `https://babel.juryquinn.com`, administrator page `/admin`.
This scaffold has not been deployed. No production infra files were changed.

## Existing infra references inspected

- `AGENTS.md`: reuse the existing public-edge LoadBalancer and Cloudflare Tunnel.
- `argocd/clusters/mididaki-prd/npcify/admin/README.md`: Access operator policy,
  protected internal administrator service, runtime configuration conventions.
- `argocd/clusters/mididaki-prd/perohub/cloudflared/README.md`: remotely managed tunnel.
- Existing PostgreSQL services: evaluate reuse before provisioning another database.

Do not copy existing secret values, another application's audience, or private
database names into this repository. Production resources must be prepared in
a dedicated managed worktree of the related `infra` repository when deployment
is requested.

## Application package

`Dockerfile` builds the Nuxt Node server with Node 24.18.0, copies only `.output`
into the runtime image, and runs as the `node` user. It does not start the voice
worker. `/api/health/live` checks the HTTP process. `/api/health/ready` requires
a migrated database. Neither endpoint proves audio, Access policy, or subtitle health.

Use the established release-driven GitHub Actions image publication flow and
SER7 self-hosted runners. No remote or registry target has been configured for
this new repository. Do not publish from a local checkout.

## Deployment work still needed

1. Configure the application repository, registry path, CI checks, and release flow.
2. Reuse an appropriate PostgreSQL service; create a restricted application role
   and database. Apply the committed migration through the approved release path.
3. Store private `NUXT_*` settings in the infra secret store. Set the canonical
   site URL and a new Access application audience for all administrator paths.
4. Route public player traffic through public-edge and protect management routes
   and origin reachability using existing Access/network conventions.
5. Add restart policy, resources, probes, logs, retention, backup, and rollback.
6. After media selection, prove the actual audio transport, required UDP/TCP
   ports, and TURN fallback if needed. HTTP readiness is insufficient.
7. Verify real operator access, mainland China player reception, browser
   background audio, and the actual AION2 PiP display mode.

No production provider key or language selection is required to prepare the
initial website deployment. Live Discord/media and operational checks remain
separate gates before claiming the product goal is complete.
