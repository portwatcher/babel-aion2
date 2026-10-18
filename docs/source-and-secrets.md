# Source and secret boundaries

The application repository is `portwatcher/babel-aion2`. It is private now and
intended for future open source. Treat every commit as potentially public.

Store only source, migrations, local example configuration, and public product
documentation here. `.env.example` contains disposable localhost settings and
empty secret fields. `.env` files, generated output, and local state are ignored.

Keep production Kubernetes manifests, release automation, database connections,
Access configuration, registry settings, and credentials in the separate private
infra repository or its secret facilities. Never copy those values into a source
file, Docker build argument, workflow log, screenshot, test fixture, or commit.

Production images are built and published by the infra repository's regular
GitHub Actions release workflow. It reads this repository through a dedicated
read-only deploy key. The image uses runtime configuration; credentials are not
part of the build context or image layers.

Before pushing, scan the complete Git history with Gitleaks, with findings
redacted. Review any finding without printing credential values. If a real secret
ever enters history, remove it from the unpublished history and rotate it before
publishing. A later deletion alone does not remove a secret from earlier commits.
