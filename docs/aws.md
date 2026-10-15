# Deploy on AWS

The container listens on port 8080 and expects TLS to terminate in front of it. Two layouts fit:

- **Lightsail container service.** `deploy/lightsail.sh` creates the service, pushes the image, and prints the Okta URLs. Lightsail provides the public `https://` hostname. This is the path to use unless you already run ECS.
- **ECS Fargate behind an Application Load Balancer.** Same image, you supply the certificate, DNS, and secrets.

Run **one** task. Sessions live in process memory and SCIM data lives in a file on the container disk. A second task has an empty store and cannot read the first task's cookies.

`GET /healthz` is the health check. It returns HTTP 200 even when SAML failed to load. After you set the Okta metadata URL, confirm the body contains `"saml":true`.

The task needs outbound HTTPS so it can fetch `SAML_IDP_METADATA_URL` at startup.

## Lightsail

A `nano` container service is enough for this app (about $7 per month; confirm current pricing in the Lightsail console). The service URL looks like:

```text
https://okta-test-app.<id>.<region>.cs.amazonlightsail.com
```

There is no load balancer, ACM certificate, or DNS record to create. There is also no persistent disk. Redeploying replaces the container and deletes SCIM users and the sign-in log.

### 1. Install the tools

You need Docker, AWS CLI v2, and the `lightsailctl` plugin. The plugin is what `aws lightsail push-container-image` shells out to. AWS documents the install in [Install the Lightsail client](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-install-software.html).

On a Mac, download the build that matches the machine. Apple silicon is `darwin-arm64`. Intel is `darwin-amd64`. `/usr/local/bin` may require `sudo`.

```bash
# Apple silicon
curl "https://s3.us-west-2.amazonaws.com/lightsailctl/latest/darwin-arm64/lightsailctl" -o /usr/local/bin/lightsailctl
# Intel
# curl "https://s3.us-west-2.amazonaws.com/lightsailctl/latest/darwin-amd64/lightsailctl" -o /usr/local/bin/lightsailctl
chmod +x /usr/local/bin/lightsailctl
```

Confirm the three tools and the account you will deploy into:

```bash
docker info
aws --version
aws sts get-caller-identity
command -v lightsailctl
```

`aws sts get-caller-identity` should print the account you intend to deploy into. The script reads the region from `aws configure get region` and falls back to `us-east-1`. Override it with `AWS_REGION=...` if you want a different Lightsail region. Container services are not in every region; if create fails, pick a region the console offers for container services.

The script builds `linux/amd64` even on an Apple silicon Mac. Docker Desktop's default emulation handles that.

### 2. Permissions

The IAM principal needs to create the container service, push an image, and create a deployment. The script calls `lightsail:CreateContainerService`, `lightsail:GetContainerServices`, and `lightsail:CreateContainerServiceDeployment`. `aws lightsail push-container-image` also registers the image through `lightsailctl`, which uses the same credentials. Deleting the service later uses `lightsail:DeleteContainerService`. Reading logs uses `lightsail:GetContainerLog`. If a call fails with `AccessDenied`, the error names the missing action.

### 3. First deploy

From the repository root:

```bash
./deploy/lightsail.sh
```

The first run:

1. Writes `.deploy.env` (mode `600`) with a generated `SCIM_TOKEN` and `SESSION_SECRET`. This file is gitignored. Keep it. Later runs reuse those values so Okta's bearer token does not change.
2. Creates a container service named `okta-test-app` at power `nano`, scale 1, if it does not already exist, and waits until the service is `READY` or `RUNNING`.
3. Builds `okta-test-app:latest` for `linux/amd64`.
4. Pushes the image and deploys it. The public endpoint health check is `GET /healthz` expecting HTTP 200.
5. Prints the ACS URL, audience URI, SCIM base URL, and SCIM token.

SAML is intentionally unset on this first deploy. The container still becomes healthy. `/login` shows that SAML is not configured until you redeploy with Okta's metadata URL.

Optional variables for this first run, or any later run:

```bash
AWS_REGION=us-east-1 \
SERVICE_NAME=okta-test-app \
POWER=nano \
ADMIN_USERS=you@example.com \
./deploy/lightsail.sh
```

Shell variables win over `.deploy.env`. The script then saves the merged result back to `.deploy.env`.

### 4. Wait until the deployment is running

```bash
aws lightsail get-container-services \
  --service-name okta-test-app \
  --query 'containerServices[0].state' \
  --output text
```

`DEPLOYING` for a few minutes, then `RUNNING`. Take the URL from `.deploy.env`'s region and the script output, or:

```bash
aws lightsail get-container-services \
  --service-name okta-test-app \
  --query 'containerServices[0].url' \
  --output text
```

```bash
curl -fsS https://YOUR-SERVICE-URL/healthz
```

Expect `{"ok":true,"saml":false}` before Okta metadata is configured.

Open `https://YOUR-SERVICE-URL/saml/metadata` and confirm the XML `entityID` and ACS `Location` use that same host.

### 5. Create the Okta app, then redeploy

Follow [Okta integration](okta.md) through the SAML app wizard. Copy the **Metadata URL** from the app's Sign On tab, then:

```bash
SAML_IDP_METADATA_URL="https://YOUR-ORG.okta.com/app/XXXXXXXX/sso/saml/metadata" \
  ./deploy/lightsail.sh
```

When the new deployment is `RUNNING`:

```bash
curl -fsS https://YOUR-SERVICE-URL/healthz
```

Expect `{"ok":true,"saml":true}`. If it stays `false`, read the container log (below). The usual causes are a metadata URL that returns non-200, or no outbound network during startup.

### 6. Turn on the options you actually want

Pass them on the redeploy. Example for policy testing, where only pushed users may sign in, `/login` always re-prompts Okta, and `/admin` is limited to one address:

```bash
SAML_IDP_METADATA_URL="https://YOUR-ORG.okta.com/app/XXXXXXXX/sso/saml/metadata" \
REQUIRE_SCIM_USER=true \
SAML_FORCE_AUTHN=true \
ADMIN_USERS="you@example.com" \
  ./deploy/lightsail.sh
```

Each of those is remembered in `.deploy.env`.

### Logs

```bash
END=$(date +%s)
START=$((END - 3600))
aws lightsail get-container-log \
  --service-name okta-test-app \
  --container-name app \
  --start-time "$START" \
  --end-time "$END" \
  --query 'logEvents[].message' \
  --output text
```

A good startup looks like:

```text
[saml] ready. IdP SSO URL: https://YOUR-ORG.okta.com/app/.../sso/saml
[app] listening on :8080  base URL https://YOUR-SERVICE-URL
[app] ACS URL:   https://YOUR-SERVICE-URL/saml/acs
[app] Entity ID: https://YOUR-SERVICE-URL/saml/metadata
[app] SCIM base: https://YOUR-SERVICE-URL/scim/v2
```

`[config] SESSION_SECRET not set` means the deploy environment dropped the secret. Check `.deploy.env` and redeploy.

### Redeploy, scale, and delete

Every `./deploy/lightsail.sh` run builds a new image and creates a new deployment. Users and groups already pushed from Okta are wiped. In Okta, open the app's **Provisioning > To App** and save again, or unassign and reassign the users, so Okta pushes them back. Group push may need the same treatment.

Leave scale at 1. Do not add a second node; it will not share `db.json` or sessions.

To remove the service:

```bash
aws lightsail delete-container-service --service-name okta-test-app
```

Deleting the service does not delete `.deploy.env`. That file still holds the SCIM token.

## ECS Fargate

Use this when the app should live on a hostname you control. The image is the same `Dockerfile`. You create the registry, secrets, certificate, load balancer, and service yourself. The repository does not ship a task definition or Terraform.

Replace the placeholders below: `REGION`, `ACCOUNT`, `okta-test.example.com`.

### 1. Build and push to ECR

```bash
aws ecr create-repository --repository-name okta-test-app --region REGION
aws ecr get-login-password --region REGION \
  | docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.REGION.amazonaws.com

docker build --platform linux/amd64 -t okta-test-app:latest .
docker tag okta-test-app:latest ACCOUNT.dkr.ecr.REGION.amazonaws.com/okta-test-app:latest
docker push ACCOUNT.dkr.ecr.REGION.amazonaws.com/okta-test-app:latest
```

### 2. Store the secrets

Create two Secrets Manager secrets, `okta-test-app/scim-token` and `okta-test-app/session-secret`, each with a value from `openssl rand -hex 32`. The SCIM token is what you paste into Okta. The session secret only needs to stay stable across restarts.

The task **execution** role needs `secretsmanager:GetSecretValue` on those two secrets, plus `AmazonECSTaskExecutionRolePolicy` so it can pull from ECR and write logs. A customer-managed KMS key on the secrets also needs `kms:Decrypt` for that role.

### 3. Network

- One VPC.
- Two public subnets for the load balancer.
- Two private subnets for the task, with a NAT gateway so the task can pull the image and fetch Okta metadata.
- A security group on the task that allows TCP 8080 from the load balancer security group only.
- A security group on the load balancer that allows TCP 443 from the testers who will sign in.

The task does not need a public IP.

### 4. Certificate, load balancer, and DNS

1. Request a public ACM certificate in the same region for `okta-test.example.com` and validate it with the DNS record ACM shows.
2. Create an ALB in the public subnets.
3. Create a target group: target type IP, protocol HTTP, port 8080, health check path `/healthz`, success code 200.
4. Add an HTTPS:443 listener using the ACM certificate, forwarding to that target group.
5. Add an HTTP:80 listener that redirects to HTTPS.
6. Create a DNS record for `okta-test.example.com` aliasing the load balancer.

`BASE_URL` will be `https://okta-test.example.com` with no trailing slash. Okta's ACS URL and audience are derived from it, so create the DNS name before you finish the Okta app. You can deploy the service first and add the metadata URL on a second revision, the same way the Lightsail flow does.

### 5. Task definition

Register a Fargate task definition with these properties:

| Field | Value |
|---|---|
| Launch type | Fargate |
| CPU / memory | 256 / 512 is enough |
| Network mode | `awsvpc` |
| Container name | `app` |
| Image | the ECR URI from step 1 |
| Port | 8080 TCP |
| `BASE_URL` | `https://okta-test.example.com` |
| `SAML_IDP_METADATA_URL` | Okta metadata URL, once you have it |
| `REQUIRE_SCIM_USER` | `true` or `false` |
| `SAML_FORCE_AUTHN` | `true` or `false` |
| `ADMIN_USERS` | optional comma-separated list |
| Secrets | `SCIM_TOKEN` and `SESSION_SECRET` from Secrets Manager |

Do not set `PORT` unless you also change the target group and the container port. The image already sets `PORT=8080` and `DATA_DIR=/data`.

There is no volume. A new task starts with an empty store.

### 6. Service

Create a Fargate service with **desired count 1**. Put it in the private subnets with the task security group, and attach it to the target group.

During a rolling deploy ECS may briefly run a second task. Sign-in cookies from the old task will not work on the new one, and SCIM data from the old disk is gone. For a test app, that is an interruption, not a failover. After each deploy, re-push users from Okta if you depend on `REQUIRE_SCIM_USER`.

Keep desired count at 1 when the deployment finishes. Do not attach an auto-scaling policy.

### 7. Check the task

Wait until the target group is healthy, then:

```bash
curl -fsS https://okta-test.example.com/healthz
```

`"saml":true` means metadata loaded. CloudWatch logs for the task should include `[saml] ready` and the ACS URL. Then continue with [Okta integration](okta.md).

To change a setting, register a new task definition revision and update the service. Restarting the task is what picks up a new metadata URL or a rotated Okta signing certificate.

## EKS

The same image runs on EKS. Use one replica, do not mount an emptyDir and expect it to survive a reschedule, terminate TLS at the ingress, set `BASE_URL` to that public `https://` origin, and inject `SCIM_TOKEN` and `SESSION_SECRET` from a Kubernetes secret. The health probe path is `/healthz` on port 8080. The pod needs egress to the Okta metadata host.
