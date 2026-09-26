# Deploying InfraAlert to Google Cloud

InfraAlert runs as **one Cloud Run service** (API + frontend) and **two Cloud Run jobs** built
from the same image: one that runs the Alembic migrations and one for operator commands
(`python -m infraalert.cli`). Around it: Cloud SQL (Postgres + PostGIS), a private Cloud
Storage bucket, a Cloud Tasks queue, Cloud Scheduler jobs, Secret Manager, Vertex AI and
Identity Platform. See the [README](../README.md) for the architecture and
[../.env.example](../.env.example) for every setting.

Placeholders are in `<angle brackets>` or are the shell variables set in step 0. Commands were
checked against the current gcloud reference where marked ✓; anything marked
**⚠ verify** is written from memory or depends on your gcloud version: check it with
`gcloud <command> --help` before relying on it.

**Why migrations run as a Cloud Run job:** the schema must be upgraded *before* new code
serves traffic, exactly once, with the production database's network path and credentials.
A job reuses the service's image, service account, Cloud SQL connection and `DATABASE_URL`
secret, so nobody needs database access from a laptop. `make deploy` runs the job (and waits
for it) before rolling out the new revision; a failed migration stops the deploy.

---

## 0. Variables and APIs

```bash
export PROJECT=<your-project-id>
export REGION=us-central1                 # Cloud Run, Cloud SQL, Tasks, Scheduler, bucket
export SERVICE=infraalert
export SA_NAME=infraalert
export SA=$SA_NAME@$PROJECT.iam.gserviceaccount.com
export SQL_INSTANCE=infraalert-db
export BUCKET=<globally-unique-bucket-name>
export QUEUE=infraalert-reports
export SITE_ORIGIN=https://<your-site-domain>   # where citizens open the site, no trailing slash

gcloud config set project $PROJECT
export PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
# Cloud Run's deterministic service URL (see step 9 to confirm it).
export SERVICE_URL=https://$SERVICE-$PROJECT_NUMBER.$REGION.run.app

gcloud services enable \
  run.googleapis.com artifactregistry.googleapis.com sqladmin.googleapis.com \
  cloudtasks.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com \
  aiplatform.googleapis.com identitytoolkit.googleapis.com iamcredentials.googleapis.com \
  storage.googleapis.com

# Where `make image` pushes (AR_REPO=infraalert in the Makefile).
gcloud artifacts repositories create infraalert \
  --repository-format=docker --location=$REGION
gcloud auth configure-docker $REGION-docker.pkg.dev
```

## 1. Cloud SQL (Postgres + PostGIS)

```bash
# ✓ --edition takes enterprise | enterprise-plus; with enterprise, size the instance with
#   --cpu/--memory (or a shared-core --tier such as db-g1-small).
gcloud sql instances create $SQL_INSTANCE \
  --database-version=POSTGRES_16 --edition=enterprise \
  --cpu=1 --memory=3840MiB --region=$REGION \
  --availability-type=zonal --backup-start-time=02:00

gcloud sql databases create infraalert --instance=$SQL_INSTANCE

export DB_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))")
gcloud sql users create infraalert --instance=$SQL_INSTANCE --password="$DB_PASSWORD"

export SQL_CONNECTION=$(gcloud sql instances describe $SQL_INSTANCE --format='value(connectionName)')
```

**PostGIS:** the first migration runs `CREATE EXTENSION IF NOT EXISTS postgis`. Users created
with `gcloud sql users create` belong to `cloudsqlsuperuser`, which may create the extension on
Cloud SQL, so no manual step is needed. If your migration job fails on it, connect once
(`gcloud sql connect $SQL_INSTANCE --user=infraalert --database=infraalert`) and run
`CREATE EXTENSION postgis;`.

The service reaches the database through the Cloud SQL connector's Unix socket, so the URL has
no host (URL-encode the password if you chose one with special characters):

```
postgresql+psycopg://infraalert:<DB_PASSWORD>@/infraalert?host=/cloudsql/<SQL_CONNECTION>
```

## 2. Private photo bucket

```bash
gcloud storage buckets create gs://$BUCKET --location=$REGION \
  --uniform-bucket-level-access --public-access-prevention

# Unclaimed uploads (citizen started a report but never submitted it) expire after a day.
cat > lifecycle.json <<'EOF'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":1,"matchesPrefix":["uploads/"]}}]}
EOF
gcloud storage buckets update gs://$BUCKET --lifecycle-file=lifecycle.json

# Browsers PUT photos straight to the bucket through signed URLs, sending these headers.
cat > cors.json <<EOF
[{"origin": ["$SITE_ORIGIN"],
  "method": ["PUT"],
  "responseHeader": ["Content-Type", "x-goog-content-length-range"],
  "maxAgeSeconds": 3600}]
EOF
gcloud storage buckets update gs://$BUCKET --cors-file=cors.json
```

If citizens reach the site on more than one origin (e.g. the `run.app` URL and a custom
domain), list each in `origin`.

## 3. Service account and IAM

One service account runs the service and the jobs, signs photo URLs, and is the identity on
every Cloud Tasks and Cloud Scheduler request (the backend only accepts `/tasks/*` calls whose
OIDC token is for `TASKS_SERVICE_ACCOUNT`).

```bash
gcloud iam service-accounts create $SA_NAME --display-name="InfraAlert service"

# Cloud SQL client
gcloud projects add-iam-policy-binding $PROJECT \
  --member=serviceAccount:$SA --role=roles/cloudsql.client

# Vertex AI (Gemini extraction)
gcloud projects add-iam-policy-binding $PROJECT \
  --member=serviceAccount:$SA --role=roles/aiplatform.user

# Storage object admin on the photo bucket only
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member=serviceAccount:$SA --role=roles/storage.objectAdmin

# Token creator on itself: signs V4 photo URLs (IAM signBlob) and task OIDC tokens
gcloud iam service-accounts add-iam-policy-binding $SA \
  --member=serviceAccount:$SA --role=roles/iam.serviceAccountTokenCreator

# ⚠ verify: Cloud Tasks requires iam.serviceAccounts.actAs on the account named in a task's
# OIDC token, and here the service names itself. roles/iam.serviceAccountUser grants it.
gcloud iam service-accounts add-iam-policy-binding $SA \
  --member=serviceAccount:$SA --role=roles/iam.serviceAccountUser
```

The Cloud Tasks enqueuer role (step 4), Secret Manager access (step 6) and `run.invoker`
(step 9) are granted on those resources once they exist.

Whoever runs the deployment (you, or a CI account) also needs `roles/iam.serviceAccountUser`
on `$SA` to deploy Cloud Run with it and to create Scheduler jobs that act as it.

## 4. Cloud Tasks queue

```bash
# Report processing retries a model outage itself (up to 3 extraction attempts, then the
# report goes to human triage), so give the queue a few more attempts than that.
# ⚠ verify the retry values against your gcloud version's `tasks queues create --help`.
gcloud tasks queues create $QUEUE --location=$REGION \
  --max-attempts=5 --min-backoff=30s --max-backoff=300s

# Cloud Tasks enqueuer, on this queue only
# ⚠ verify: queue-level bindings; if your gcloud lacks this command, bind
#   roles/cloudtasks.enqueuer at project level with `gcloud projects add-iam-policy-binding`.
gcloud tasks queues add-iam-policy-binding $QUEUE --location=$REGION \
  --member=serviceAccount:$SA --role=roles/cloudtasks.enqueuer

export CLOUD_TASKS_QUEUE=projects/$PROJECT/locations/$REGION/queues/$QUEUE
```

## 5. Identity Platform (staff sign-in)

Staff sign in through the city's SSO via an OIDC provider in Identity Platform; the backend
accepts only tokens from that provider with a verified email.

1. Console → **Identity Platform** → enable it for the project (same project as `$PROJECT`;
   the backend verifies tokens issued for `GOOGLE_CLOUD_PROJECT`).
2. **Providers → Add a provider → OpenID Connect**. Enter the city IdP's client ID, issuer and
   (for code flow) client secret. Give it the provider ID `oidc.city-sso` (any `oidc.*` name;
   it becomes `STAFF_SIGN_IN_PROVIDER` and `VITE_STAFF_SIGN_IN_PROVIDER`). Register the
   callback URL the console shows (`https://<PROJECT>.firebaseapp.com/__/auth/handler`) with
   the city IdP. The IdP must send `email` and `email_verified=true`.
3. **Settings → Authorized domains**: add your site's domain (and the `run.app` host if used).
4. **Application setup details** shows the web `apiKey` and `authDomain` for the frontend build.

⚠ verify: scripted alternative for step 2 (Identity Toolkit admin API v2):

```bash
curl -X POST \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT/oauthIdpConfigs?oauthIdpConfigId=oidc.city-sso" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "X-Goog-User-Project: $PROJECT" -H "Content-Type: application/json" \
  -d '{"displayName":"City SSO","enabled":true,"issuer":"<issuer-url>",
       "clientId":"<client-id>","clientSecret":"<client-secret>",
       "responseType":{"code":true}}'
```

Frontend build variables (baked into the image by `make image`; export them in the shell that
runs `make deploy`, see [webapp/frontend/.env.example](../webapp/frontend/.env.example)):

```bash
export VITE_STAFF_AUTH=identity_platform
export VITE_FIREBASE_API_KEY=<web api key>
export VITE_FIREBASE_AUTH_DOMAIN=$PROJECT.firebaseapp.com
export VITE_FIREBASE_PROJECT_ID=$PROJECT
export VITE_STAFF_SIGN_IN_PROVIDER=oidc.city-sso
export VITE_TURNSTILE_SITE_KEY=<turnstile site key>
export VITE_MAPTILER_KEY=<maptiler key, restricted to your domain>
export VITE_MAP_DEFAULT_CENTER=<lat,lng>
export VITE_EMERGENCY_NUMBER=<number>
```

Keep them in an untracked file (e.g. `deploy.env`) and load it with
`set -a; source deploy.env; set +a` before each deploy.

## 6. Secrets

```bash
create_secret() { printf '%s' "$2" | gcloud secrets create "$1" --data-file=- --replication-policy=automatic; }

create_secret infraalert-database-url \
  "postgresql+psycopg://infraalert:$DB_PASSWORD@/infraalert?host=/cloudsql/$SQL_CONNECTION"
create_secret infraalert-turnstile-secret-key '<Cloudflare Turnstile secret key>'
create_secret infraalert-rate-limit-secret "$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
create_secret infraalert-smtp-password '<SMTP password>'

for s in infraalert-database-url infraalert-turnstile-secret-key \
         infraalert-rate-limit-secret infraalert-smtp-password; do
  gcloud secrets add-iam-policy-binding $s \
    --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
done
```

## 7. First image

```bash
set -a; source deploy.env; set +a
make image REGION=$REGION PROJECT=$PROJECT     # prints the IMAGE it pushed
export IMAGE=$REGION-docker.pkg.dev/$PROJECT/infraalert/$SERVICE:$(git rev-parse --short HEAD)
```

## 8. Migration and CLI jobs

```bash
# ✓ flags per `gcloud run jobs create` reference
gcloud run jobs create $SERVICE-migrate --image=$IMAGE --region=$REGION \
  --service-account=$SA --set-cloudsql-instances=$SQL_CONNECTION \
  --set-secrets=DATABASE_URL=infraalert-database-url:latest \
  --command=alembic --args=upgrade,head \
  --max-retries=0 --task-timeout=10m

gcloud run jobs execute $SERVICE-migrate --region=$REGION --wait

# Operator commands (python -m infraalert.cli ...). The args are set per execution.
gcloud run jobs create $SERVICE-cli --image=$IMAGE --region=$REGION \
  --service-account=$SA --set-cloudsql-instances=$SQL_CONNECTION \
  --set-secrets=DATABASE_URL=infraalert-database-url:latest \
  --command=python --args=-m,infraalert.cli,--help \
  --max-retries=0 --task-timeout=10m
```

`make deploy` later points `$SERVICE-migrate` at each new image and runs it. Update the CLI job
the same way when you need a newer CLI:
`gcloud run jobs update $SERVICE-cli --image=$IMAGE --region=$REGION`.

## 9. The Cloud Run service

Non-secret settings go in a YAML file (values contain commas and spaces):

```bash
cat > env.prod.yaml <<EOF
STORAGE_BACKEND: gcs
GCS_BUCKET: $BUCKET
PUBLIC_BASE_URL: $SITE_ORIGIN
TASKS_BACKEND: cloud_tasks
CLOUD_TASKS_QUEUE: $CLOUD_TASKS_QUEUE
SERVICE_URL: $SERVICE_URL
TASKS_SERVICE_ACCOUNT: $SA
EXTRACTOR_BACKEND: vertex
GOOGLE_CLOUD_PROJECT: $PROJECT
GOOGLE_CLOUD_REGION: $REGION
GEMINI_MODEL: "<a Vertex AI Gemini model id available in $REGION>"
STAFF_AUTH_BACKEND: identity_platform
STAFF_SIGN_IN_PROVIDER: oidc.city-sso
EMAIL_BACKEND: smtp
EMAIL_FROM: "InfraAlert <no-reply@<your-domain>>"
SMTP_HOST: <smtp host>
SMTP_PORT: "587"
SMTP_USERNAME: <smtp username>
RATE_LIMIT_PER_HOUR: "5"
TRUSTED_PROXY_HOPS: "0"
CITY_BBOX: "<south>,<west>,<north>,<east>"
EOF

gcloud run deploy $SERVICE --image=$IMAGE --region=$REGION \
  --service-account=$SA --allow-unauthenticated \
  --add-cloudsql-instances=$SQL_CONNECTION \
  --env-vars-file=env.prod.yaml \
  --set-secrets=DATABASE_URL=infraalert-database-url:latest,TURNSTILE_SECRET_KEY=infraalert-turnstile-secret-key:latest,RATE_LIMIT_SECRET=infraalert-rate-limit-secret:latest,SMTP_PASSWORD=infraalert-smtp-password:latest

# run.invoker for the identity Cloud Tasks and Cloud Scheduler call /tasks/* with. (The site
# is public, so allUsers already has it; this keeps /tasks/* working if you later remove
# --allow-unauthenticated or front the service with IAP.)
gcloud run services add-iam-policy-binding $SERVICE --region=$REGION \
  --member=serviceAccount:$SA --role=roles/run.invoker
```

Check the URL: `gcloud run services describe $SERVICE --region=$REGION --format='value(status.url)'`.
⚠ verify: services can have both a deterministic URL (`https://SERVICE-PROJECT_NUMBER.REGION.run.app`)
and an older hashed one; `SERVICE_URL` may be either, but it must be **the exact URL** the tasks
and scheduler jobs target, because the backend checks each token's audience against
`SERVICE_URL + path`. If you change it, redeploy with the new value and recreate step 10.

Later deploys keep all of this configuration: `make deploy` only swaps the image
(`gcloud run deploy --image`), after running the migration job.

A custom domain (Cloud Run domain mapping or an external HTTPS load balancer) is optional; behind
a load balancer set `TRUSTED_PROXY_HOPS=1`, and add the domain to the bucket CORS and Identity
Platform authorized domains.

## 10. Cloud Scheduler jobs

Each job sends a POST with an OIDC token for `$SA` whose **audience is the exact endpoint URL**.

```bash
schedule() {  # name, cron, path, [attempt deadline]
  gcloud scheduler jobs create http "$SERVICE-$1" --location=$REGION \
    --schedule="$2" --time-zone=UTC \
    --uri="$SERVICE_URL$3" --http-method=POST \
    --oidc-service-account-email=$SA --oidc-token-audience="$SERVICE_URL$3" \
    --attempt-deadline="${4:-180s}"
}

schedule sweep         "*/5 * * * *" /tasks/sweep          # re-enqueue reports that missed their task
schedule notifications "* * * * *"   /tasks/notifications  # deliver citizen emails
schedule retention     "30 3 * * *"  /tasks/retention      # daily data retention
schedule import-osm    "0 4 1 * *"   /tasks/import-osm 900s # monthly OpenStreetMap refresh
```

(Cloud Scheduler's HTTP attempt deadline is at most 30 minutes; the OSM import depends on
Overpass's speed for your `CITY_BBOX`.)

## 11. First admin and first OSM import

```bash
# Invites the first admin; they are linked on their first Identity Platform sign-in.
gcloud run jobs execute $SERVICE-cli --region=$REGION --wait \
  --args=-m,infraalert.cli,create-admin,--email=<admin@city.example>,--name=<Full Name>

# Load sensitive places (hospitals, schools, major roads) for CITY_BBOX now instead of
# waiting for the first of the month.
gcloud scheduler jobs run $SERVICE-import-osm --location=$REGION
```

`--args` on `jobs execute` overrides the job's arguments for that execution only (✓ per the
reference). Arguments are comma-separated, so use `--flag=value` and keep commas out of values;
a name with spaces must be quoted as a whole, e.g. `"--args=-m,infraalert.cli,create-admin,--email=ada@city.example,--name=Ada Lovelace"`.

The import's result is in the service logs
(`gcloud run services logs read $SERVICE --region=$REGION`); the admin can also see the last
import time on the staff Places page.

## 12. Routine deploys

```bash
set -a; source deploy.env; set +a
make deploy PROJECT=$PROJECT REGION=$REGION
```

This builds and pushes the image (`linux/amd64`, tagged with the git commit), updates and runs
the `$SERVICE-migrate` job (stopping if it fails), then deploys the image to the service.
Write migrations to be compatible with the previous revision, since the old code keeps serving
until the new revision is ready.

## Smoke-test checklist

- [ ] `curl $SERVICE_URL/api/health` returns `{"status":"ok"}` (database reachable).
- [ ] `curl -i -X POST $SERVICE_URL/tasks/sweep` without a token returns **403**.
- [ ] `gcloud scheduler jobs run $SERVICE-sweep --location=$REGION` succeeds, and the job's last
      attempt shows success (`gcloud scheduler jobs describe $SERVICE-sweep --location=$REGION`),
      proving the OIDC audience and service account are right.
- [ ] Open the site, pass Turnstile, attach a photo and submit a report. The photo PUT to
      `storage.googleapis.com` succeeds (no CORS error in the browser console).
- [ ] Within a minute the report leaves "received": the Cloud Tasks queue drained
      (`gcloud tasks queues describe $QUEUE --location=$REGION`) and the logs show extraction
      from Vertex AI, not a model error.
- [ ] `gsutil`/`gcloud storage ls gs://$BUCKET/reports/` shows the claimed photo; the bucket is
      not publicly readable.
- [ ] The first admin signs in at `/staff` through the city SSO and sees the incident; a
      photo opens (signed view URL).
- [ ] Subscribe to updates on a report with a real address: the verification email arrives (SMTP).
- [ ] The staff Places page lists imported OpenStreetMap places.
- [ ] Rate limiting: more than `RATE_LIMIT_PER_HOUR` submissions from one client are refused.
