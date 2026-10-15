# Okta Test App

A bare SAML 2.0 service provider with a SCIM 2.0 provisioning endpoint, for testing Okta sign-on and authentication policies (for example, requiring a phishing-resistant authenticator). The app shows what Okta sent: NameID, authentication context, attribute statements, the raw assertion, provisioned users and groups, and a SCIM request log.

## Documentation

| Guide | What it covers |
|---|---|
| [Architecture](docs/architecture.md) | SAML and SCIM behavior, sessions, data, health checks |
| [Configuration](docs/configuration.md) | Every environment variable |
| [Local development](docs/local-development.md) | Run and test on your machine |
| [Deploy on AWS](docs/aws.md) | Lightsail (scripted) and ECS Fargate |
| [Integrate with Okta](docs/okta.md) | SAML app, SCIM, assignments, authentication policies |
| [Troubleshooting](docs/troubleshooting.md) | Health, login errors, provisioning, deploy failures |

## Endpoints

| Path | Purpose |
|---|---|
| `/saml/acs` | Assertion Consumer Service (Okta "Single sign-on URL") |
| `/saml/metadata` | SP metadata. This URL is also the default SP Entity ID / Audience |
| `/login` | SP-initiated login |
| `/logout` | Clears this app's session. The Okta session stays |
| `/scim/v2` | SCIM base URL (`/Users`, `/Groups`, `/ServiceProviderConfig`, `/ResourceTypes`) |
| `/admin` | Recent sign-ins, SCIM users and groups, SCIM request log |
| `/healthz` | `{"ok":true,"saml":true\|false}`. HTTP 200 either way |

## Deploy

Lightsail container services give you a public HTTPS URL. Prerequisites, IAM, redeploy, logs, and the ECS alternative are in [Deploy on AWS](docs/aws.md).

```bash
./deploy/lightsail.sh
```

The first run prints the ACS URL, audience, SCIM base URL, and bearer token. Secrets are saved to `.deploy.env` (gitignored). After the Okta app exists:

```bash
SAML_IDP_METADATA_URL="https://YOUR-ORG.okta.com/app/XXXX/sso/saml/metadata" \
  ./deploy/lightsail.sh
```

Then follow [Integrate with Okta](docs/okta.md). Data lives on the container disk and is wiped on every deploy. Run one copy of the app.

## Run locally

Node.js 22 or newer.

```bash
npm install
cp .env.example .env   # SCIM_TOKEN and SESSION_SECRET at minimum
node --env-file=.env src/server.js
```

```bash
npm test
```

Okta can post SAML responses to a URL the browser can reach. SCIM calls come from Okta's network, so provisioning needs the deployed URL. Details are in [Local development](docs/local-development.md).
