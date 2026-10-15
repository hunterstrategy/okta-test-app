# Okta Test App

A bare SAML 2.0 service provider with a SCIM 2.0 provisioning endpoint, built to test Okta sign-on and authentication policies (for example, requiring phishing-resistant authenticators). The app itself does nothing. It shows you what Okta sent.

- **SAML 2.0 SSO**, both SP-initiated (`/login`) and IdP-initiated (the Okta dashboard tile)
- **SCIM 2.0** users and groups (create, update, deactivate, group push), bearer-token auth
- **Home page** shows the NameID, AuthnContextClassRef, AuthnInstant, attribute statements and the raw signed assertion
- **Admin console** (`/admin`) shows recent sign-ins (success and failure), SCIM-provisioned users and groups, and a SCIM request log
- Optional `REQUIRE_SCIM_USER=true` so only users assigned and pushed from Okta can sign in

## Endpoints

| Path | Purpose |
|---|---|
| `/saml/acs` | Assertion Consumer Service (Okta "Single sign-on URL") |
| `/saml/metadata` | SP metadata; this URL is also the SP Entity ID / Audience |
| `/login` | SP-initiated login |
| `/scim/v2` | SCIM base URL (`/Users`, `/Groups`, `/ServiceProviderConfig`, `/ResourceTypes`) |
| `/admin` | Admin console |
| `/healthz` | Health check |

## Deploy to AWS (Lightsail containers)

Lightsail container services give you a public HTTPS URL without setting up a load balancer, certificate or DNS. A `nano` service runs about $7/month.

Prereqs: Docker, AWS CLI v2 signed in to the target account, and the [`lightsailctl` plugin](https://lightsail.aws.amazon.com/ls/docs/en_us/articles/amazon-lightsail-install-software).

```bash
./deploy/lightsail.sh
```

The first run creates the service, deploys the app and prints the URLs and SCIM token to give Okta. Secrets are saved to `.deploy.env` (gitignored) so redeploys keep the same SCIM token.

Once the Okta app exists (see below), redeploy with its metadata URL:

```bash
SAML_IDP_METADATA_URL="https://YOUR-ORG.okta.com/app/XXXX/sso/saml/metadata" ./deploy/lightsail.sh
```

Optional settings work the same way: `REQUIRE_SCIM_USER=true`, `ADMIN_USERS=you@hunterstrategy.net`, `SAML_FORCE_AUTHN=true`, `AWS_REGION=us-east-1`, `SERVICE_NAME=okta-test-app`.

**Data is not persistent.** SCIM users and the sign-in log live in the container's local disk and are wiped on redeploy. In Okta, re-push by going to Provisioning > To App and re-saving, or unassign and reassign users.

### Other AWS targets

The image is a plain container listening on port 8080, so it also runs on ECS Fargate or EKS. Requirements:

- HTTPS in front of it (ALB + ACM certificate). Set `BASE_URL` to the public `https://` URL.
- Run **one** task. Sessions and data are in memory and on local disk.
- Health check path `/healthz`.
- Pass `SCIM_TOKEN` and `SESSION_SECRET` from Secrets Manager or SSM.

## Okta setup

### 1. SAML app

Applications > Create App Integration > **SAML 2.0**.

| Field | Value |
|---|---|
| Single sign-on URL | `https://<app-url>/saml/acs` (check "Use this for Recipient URL and Destination URL") |
| Audience URI (SP Entity ID) | `https://<app-url>/saml/metadata` |
| Name ID format | EmailAddress |
| Application username | Okta username |

Attribute statements (optional, but they show up on the home page):

| Name | Value |
|---|---|
| `email` | `user.email` |
| `firstName` | `user.firstName` |
| `lastName` | `user.lastName` |

Finish, then on the **Sign On** tab copy the **Metadata URL** and redeploy with it as `SAML_IDP_METADATA_URL`.

### 2. SCIM provisioning

1. **General** tab > App Settings > Edit > Provisioning: select **SCIM** > Save.
2. **Provisioning** tab > Integration > Edit:
   - SCIM connector base URL: `https://<app-url>/scim/v2`
   - Unique identifier field for users: `userName`
   - Supported provisioning actions: Import New Users and Profile Updates, Push New Users, Push Profile Updates, Push Groups
   - Authentication Mode: **HTTP Header**, Authorization: the `SCIM_TOKEN` printed by the deploy script
   - Test Connector Configuration > Save
3. **Provisioning** > To App > Edit: enable Create Users, Update User Attributes, Deactivate Users.
4. **Assignments**: assign test users or groups. They should appear in `/admin` within a few seconds.

If you'd rather skip SCIM, leave `REQUIRE_SCIM_USER` unset and anyone assigned to the app in Okta can sign in.

### 3. Testing phishing-resistant auth

1. Create an authentication policy (Security > Authentication Policies) with a rule requiring a possession factor with the **Phishing resistant** constraint (FastPass, FIDO2/WebAuthn, smart card).
2. On the app's **Sign On** tab, assign that policy.
3. Deploy with `SAML_FORCE_AUTHN=true` so each `/login` makes Okta re-evaluate the policy instead of reusing the existing session.
4. Sign in from `/login` and from the Okta dashboard. Successes and failures show in `/admin` > Recent sign-ins. Policy denials happen at Okta and never reach the app, so check Okta's System Log for those.

Note that Okta's `AuthnContextClassRef` is usually `PasswordProtectedTransport` regardless of which factors were used, so don't rely on it to prove a phishing-resistant factor was used. The Okta System Log is the authoritative record.

## Run locally

```bash
npm install
cp .env.example .env   # fill in values
node --env-file=.env src/server.js
```

Okta will post SAML responses to `http://localhost:8080/saml/acs` because the browser does the POST. SCIM needs a publicly reachable URL, so test it against the deployed instance.

```bash
npm test
```

The tests boot the server against a fake IdP, post signed and tampered SAML responses, and walk through the SCIM calls Okta makes.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `BASE_URL` | `http://localhost:8080` | Public URL. Used for ACS, entity ID and secure cookies. |
| `SAML_IDP_METADATA_URL` | | Okta app metadata URL (preferred) |
| `SAML_IDP_SSO_URL` / `SAML_IDP_CERT` / `SAML_IDP_ISSUER` | | Manual alternative to the metadata URL |
| `SAML_SP_ENTITY_ID` | `${BASE_URL}/saml/metadata` | |
| `SAML_WANT_ASSERTIONS_SIGNED` | `true` | |
| `SAML_WANT_RESPONSE_SIGNED` | `false` | Okta signs the Response by default too; set `true` to require it |
| `SAML_FORCE_AUTHN` | `false` | Sends `ForceAuthn="true"` on SP-initiated logins |
| `SAML_AUTHN_CONTEXT` | | Comma-separated AuthnContextClassRefs to request |
| `SCIM_TOKEN` | | Required for SCIM. Without it `/scim/v2` returns 503. |
| `SESSION_SECRET` | random | Set it, or sessions reset on every restart |
| `REQUIRE_SCIM_USER` | `false` | Deny SAML logins for users not provisioned and active via SCIM |
| `ADMIN_USERS` | | Comma-separated emails allowed into `/admin`; empty means any signed-in user |
| `PORT` | `8080` | |
| `DATA_DIR` | `./data` (`/data` in the container) | |
