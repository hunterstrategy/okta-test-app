#!/usr/bin/env bash
# Build the image and deploy it to an AWS Lightsail container service.
# Lightsail gives you a public HTTPS URL out of the box, so no ALB, ACM cert, or DNS is needed.
#
# Prereqs: docker, aws cli v2 (logged in), and the lightsailctl plugin:
#   https://lightsail.aws.amazon.com/ls/docs/en_us/articles/amazon-lightsail-install-software
#
# Usage:
#   ./deploy/lightsail.sh                     # first run: creates the service, deploys with SAML unconfigured
#   SAML_IDP_METADATA_URL=https://... ./deploy/lightsail.sh   # redeploy once Okta's metadata URL exists
#
# Generated secrets (SCIM_TOKEN, SESSION_SECRET) and settings are saved to .deploy.env so redeploys keep them.
set -euo pipefail

cd "$(dirname "$0")/.."
STATE_FILE=.deploy.env
# Load saved values, but let variables passed on the command line win.
if [[ -f $STATE_FILE ]]; then
  while IFS='=' read -r key value; do
    [[ -n $key && -z ${!key:-} ]] && printf -v "$key" '%s' "$value"
  done < "$STATE_FILE"
fi

SERVICE_NAME=${SERVICE_NAME:-okta-test-app}
AWS_REGION=${AWS_REGION:-$(aws configure get region || echo us-east-1)}
POWER=${POWER:-nano}   # nano (~$7/mo) is plenty
SCIM_TOKEN=${SCIM_TOKEN:-$(openssl rand -hex 32)}
SESSION_SECRET=${SESSION_SECRET:-$(openssl rand -hex 32)}
SAML_IDP_METADATA_URL=${SAML_IDP_METADATA_URL:-}
REQUIRE_SCIM_USER=${REQUIRE_SCIM_USER:-false}
ADMIN_USERS=${ADMIN_USERS:-}
SAML_FORCE_AUTHN=${SAML_FORCE_AUTHN:-false}
export AWS_REGION

cat > "$STATE_FILE" <<EOF
SERVICE_NAME=$SERVICE_NAME
AWS_REGION=$AWS_REGION
POWER=$POWER
SCIM_TOKEN=$SCIM_TOKEN
SESSION_SECRET=$SESSION_SECRET
SAML_IDP_METADATA_URL=$SAML_IDP_METADATA_URL
REQUIRE_SCIM_USER=$REQUIRE_SCIM_USER
ADMIN_USERS=$ADMIN_USERS
SAML_FORCE_AUTHN=$SAML_FORCE_AUTHN
EOF
chmod 600 "$STATE_FILE"

if ! aws lightsail get-container-services --service-name "$SERVICE_NAME" >/dev/null 2>&1; then
  echo "==> Creating Lightsail container service '$SERVICE_NAME' in $AWS_REGION"
  aws lightsail create-container-service --service-name "$SERVICE_NAME" --power "$POWER" --scale 1 >/dev/null
fi

echo "==> Waiting for service to be ready"
until state=$(aws lightsail get-container-services --service-name "$SERVICE_NAME" \
    --query 'containerServices[0].state' --output text) && [[ $state == READY || $state == RUNNING ]]; do
  echo "    state: $state"; sleep 10
done

BASE_URL=$(aws lightsail get-container-services --service-name "$SERVICE_NAME" \
  --query 'containerServices[0].url' --output text)
BASE_URL=${BASE_URL%/}

echo "==> Building image (linux/amd64)"
docker build --platform linux/amd64 -t "$SERVICE_NAME:latest" .

echo "==> Pushing image to Lightsail"
PUSH_OUT=$(aws lightsail push-container-image --service-name "$SERVICE_NAME" --label app --image "$SERVICE_NAME:latest")
echo "$PUSH_OUT"
IMAGE=$(echo "$PUSH_OUT" | grep -o "\":$SERVICE_NAME\.app\.[0-9]*\"" | tr -d '"' | tail -1)
[[ -n $IMAGE ]] || { echo "Could not determine pushed image name"; exit 1; }

echo "==> Deploying $IMAGE"
CONTAINERS=$(IMAGE="$IMAGE" BASE_URL="$BASE_URL" SCIM_TOKEN="$SCIM_TOKEN" SESSION_SECRET="$SESSION_SECRET" \
  SAML_IDP_METADATA_URL="$SAML_IDP_METADATA_URL" REQUIRE_SCIM_USER="$REQUIRE_SCIM_USER" \
  ADMIN_USERS="$ADMIN_USERS" SAML_FORCE_AUTHN="$SAML_FORCE_AUTHN" node -e '
  const e = process.env;
  const environment = {
    BASE_URL: e.BASE_URL, SCIM_TOKEN: e.SCIM_TOKEN, SESSION_SECRET: e.SESSION_SECRET,
    SAML_IDP_METADATA_URL: e.SAML_IDP_METADATA_URL, REQUIRE_SCIM_USER: e.REQUIRE_SCIM_USER,
    ADMIN_USERS: e.ADMIN_USERS, SAML_FORCE_AUTHN: e.SAML_FORCE_AUTHN,
  };
  for (const k of Object.keys(environment)) if (!environment[k]) delete environment[k];
  console.log(JSON.stringify({ app: { image: e.IMAGE, ports: { "8080": "HTTP" }, environment } }));
')

aws lightsail create-container-service-deployment --service-name "$SERVICE_NAME" \
  --containers "$CONTAINERS" \
  --public-endpoint '{"containerName":"app","containerPort":8080,"healthCheck":{"path":"/healthz","successCodes":"200"}}' \
  >/dev/null

cat <<EOF

==> Deployment started (takes 2-5 minutes). Watch it with:
    aws lightsail get-container-services --service-name $SERVICE_NAME --query 'containerServices[0].state'

Values for Okta:
  Single sign-on URL (ACS):      $BASE_URL/saml/acs
  Audience URI (SP Entity ID):   $BASE_URL/saml/metadata
  SCIM connector base URL:       $BASE_URL/scim/v2
  SCIM unique identifier field:  userName
  SCIM auth (HTTP Header) token: $SCIM_TOKEN

Saved to $STATE_FILE (keep it out of git).
EOF
[[ -n $SAML_IDP_METADATA_URL ]] || echo "SAML is not configured yet. Re-run with SAML_IDP_METADATA_URL=<Okta metadata URL>."
