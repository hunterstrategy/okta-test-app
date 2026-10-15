# Architecture

Okta Test App is a single Node.js process. It accepts SAML 2.0 logins from Okta and SCIM 2.0 provisioning pushes from Okta, then shows you what arrived. It does not implement its own passwords, MFA, or user directory beyond the records Okta pushes.

```
Browser                Okta                      This app
  |                      |                          |
  |--- GET /login ------>|                          |
  |                      |<---- AuthnRequest -------|  SP-initiated
  |--- sign in at Okta ->|                          |
  |<----- SAMLResponse (HTTP POST) ---------------->|  /saml/acs
  |                      |                          |
  |                      |--- SCIM /Users, /Groups ->|  bearer token
  |                      |                          |
  |--- GET / and /admin --------------------------->|  session cookie
```

IdP-initiated login skips `/login`. The user clicks the app tile in the Okta dashboard, and Okta POSTs the assertion straight to `/saml/acs`.

## Process layout

| File | Role |
|---|---|
| `src/server.js` | HTTP routes, session cookie, admin gate, startup |
| `src/saml.js` | Load Okta metadata, validate the POST, read the assertion |
| `src/scim.js` | SCIM 2.0 `/Users` and `/Groups` |
| `src/store.js` | JSON file under `DATA_DIR` (`db.json`) |
| `src/config.js` | Environment variables |
| `src/views.js` | HTML for `/`, `/admin`, and error pages |
| `deploy/lightsail.sh` | Build the image and deploy a Lightsail container service |
| `Dockerfile` | Production image: Node 24, listens on 8080, runs as `node` |

`node-saml` validates signatures, audience, recipient, and time window. Express serves the pages. `express-session` keeps the signed-in user in a cookie named `okta_test_sid`.

## SAML

On startup the app loads the identity provider once:

1. If `SAML_IDP_METADATA_URL` is set, it fetches that URL and reads the entity ID, HTTP-Redirect SSO URL (falling back to the first SSO URL), and signing certificates.
2. Otherwise it uses `SAML_IDP_SSO_URL` plus `SAML_IDP_CERT` (and `SAML_IDP_ISSUER` when set).

A failed fetch or a missing configuration leaves SAML disabled. The process still listens. `/healthz` returns `"saml": false`, and `/login` returns 503. Restart the process after fixing the configuration. Metadata is not refreshed in the background, so an Okta certificate rotation needs a restart.

Validation settings that matter for Okta:

- The assertion must be signed (`SAML_WANT_ASSERTIONS_SIGNED` defaults to true).
- The outer response signature is optional (`SAML_WANT_RESPONSE_SIGNED` defaults to false). Okta signs the response as well, and you can require it.
- `InResponseTo` is not checked, so a login that started at the Okta dashboard is accepted.
- Clock skew allowance is 60 seconds.
- The audience and the ACS URL both come from `BASE_URL` unless `SAML_SP_ENTITY_ID` overrides the audience.

`/login` sends `RelayState` of `sp:<path>`. After a successful POST, a relay value with that prefix is an SP-initiated login and the user is sent to that path. Any other relay value, including an empty one, is treated as IdP-initiated and the user lands on `/`.

When `REQUIRE_SCIM_USER=true`, a valid assertion is still rejected unless `NameID` or the `email` attribute matches an **active** SCIM `userName`.

`/logout` deletes the app session only. The Okta session stays in the browser. Set `SAML_FORCE_AUTHN=true` when you need Okta to run the authentication policy again on the next `/login`.

The app does not sign authentication requests and does not publish a signing certificate in its metadata. Leave Okta's "signed requests" requirement off.

## SCIM

`/scim/v2` is mounted before the session middleware. Callers authenticate with `Authorization: Bearer <SCIM_TOKEN>`. The comparison is constant-time. With no token configured, every SCIM call returns 503.

Supported operations match what Okta's SCIM connector sends:

| Resource | Operations |
|---|---|
| `/ServiceProviderConfig`, `/ResourceTypes` | GET |
| `/Users` | GET (filter, pagination), POST |
| `/Users/:id` | GET, PUT, PATCH, DELETE |
| `/Groups` | GET (filter, `excludedAttributes=members`), POST |
| `/Groups/:id` | GET, PUT, PATCH, DELETE |

Filters are a single `attr eq "value"` comparison, case-insensitive. That covers Okta's `userName eq "..."` lookup. Other filter syntax returns 400 `invalidFilter`.

User PATCH accepts `add` and `replace`. Group PATCH accepts member `add`, `remove` (including `members[value eq "..."]`), and `replace`. Extra user attributes Okta sends, including enterprise extension URNs, are stored and returned.

`userName` is unique, compared case-insensitively. A second POST for the same username returns 409.

## Sessions and the admin console

A successful ACS call regenerates the session and stores NameID, NameID format, issuer, session index, `AuthnContextClassRef`, `AuthnInstant`, attribute statements, the raw assertion XML, which flow was used, and whether a SCIM user matched.

The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` when `BASE_URL` starts with `https://`. Lifetime is 8 hours.

`/admin` requires a session. If `ADMIN_USERS` is set, `NameID` or the `email` attribute must be in that list (case-insensitive). An empty list means every signed-in user can open `/admin`.

The admin page reads the JSON store: the last 50 sign-in attempts (the file keeps 200), SCIM users, SCIM groups, and the last 50 SCIM requests.

## Data

`src/store.js` writes `DATA_DIR/db.json`. The container image sets `DATA_DIR=/data`. Nothing replicates that file. Two copies of the process would each have their own users, sessions, and logs. Run one task, and expect the file to disappear when the container is replaced.

## Health

`GET /healthz` returns `{"ok":true,"saml":true}` or `{"ok":true,"saml":false}`. The HTTP status is 200 in both cases, so a load balancer will keep a task in service even when SAML failed to initialize. Check the `saml` field, or the log line `[saml] ready`, before testing login.

The app sets `trust proxy`, so it is meant to sit behind Lightsail's proxy or an ALB that sets `X-Forwarded-*`.
