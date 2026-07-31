# GCP deployment

Use this after the choices and billing confirmation in `deployment.md`.

## Status

The GCP target is scaffolding-only in this release. What works today:

- `qm init --target gcp` scaffolds a deployment repository with a `gcp`
  config block (project, region, Artifact Registry repository, Secret
  Manager prefix, image label).
- `qm check` validates the repository, including the GCP durability
  contract (object storage over GCS S3 interoperability) and the sandbox
  configuration.
- `qm sandbox publish` publishes the agent-computer layer image to the Fly
  sandbox app — GCP deployments run Fly Sprites sandboxes as the documented
  interim until a GCP-native sandbox substrate exists.

The deploy path — Cloud Run services for `qm up`/`status`/`logs`/`down`,
native-revision rollback, Secret Manager pushes, and the Terraform module
behind `qm infra` — lands in a following release. Until then `qm up` and its
siblings fail with an explicit message on this target.

## Intended shape (for planning)

| Need                      | GCP service                                                                       |
| ------------------------- | --------------------------------------------------------------------------------- |
| Runtime (one per service) | Cloud Run services (core: min-instances=1, CPU always allocated, max-instances=1) |
| Postgres                  | Cloud SQL                                                                         |
| Object storage            | GCS via S3-interoperability HMAC keys (native store later)                        |
| Secrets                   | Secret Manager references                                                         |
| Rollback                  | Cloud Run revisions                                                               |
| Images                    | Artifact Registry                                                                 |
| Agent sandboxes           | Fly Sprites (interim); GCE-backed substrate planned                               |

## Preflight (what you can prepare now)

```bash
gcloud auth list
gcloud projects describe <project-id>
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com
```

Fill the `gcp` block in the config, set `publicUrl` to the domain that will
front the Cloud Run core, create the Fly sandbox app named in
`sandbox.app`, and run:

```bash
npm exec qm -- sandbox publish
npm exec qm -- check
```
