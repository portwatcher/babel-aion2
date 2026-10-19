# Source and secret boundaries

The application repository is `portwatcher/babel-aion2`. It is private now and
intended for future open source. Treat every commit as potentially public.

Store only source, migrations, local example configuration, and public product
documentation here. `.env.example` contains disposable localhost settings and
empty secret fields. `.env` files, generated output, and local state are ignored.

Keep production Kubernetes manifests, deployment-specific tooling, database connections,
Access configuration, registry settings, and credentials in the separate private
infra repository or its secret facilities. Never copy those values into a source
file, Docker build argument, workflow log, screenshot, test fixture, or commit.

The source repository's generic GitHub Actions workflow validates pull requests
and automatically publishes and deploys current `main` commits. Registry and
infra destinations come from repository variables; registry authentication and a
dedicated infra write deploy key come from GitHub Secrets. The workflow checks
out private infra tooling alongside the source, outside the Docker build context.
The existing private manual release workflow remains available for operators.
Images use runtime configuration; credentials are not part of their layers.

Before pushing, scan the complete Git history with Gitleaks, with findings
redacted. Review any finding without printing credential values. If a real secret
ever enters history, remove it from the unpublished history and rotate it before
publishing. A later deletion alone does not remove a secret from earlier commits.
