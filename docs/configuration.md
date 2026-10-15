# Configuration

Every setting is an environment variable. Copy `.env.example` to `.env` for local runs. The Lightsail script writes `.deploy.env` and passes a subset of these variables into the container. See [AWS](aws.md) for which ones the script forwards.

Boolean values accept `1`, `true`, `yes`, and `on`. Anything else, including `false`, is false.

| Variable | Default | Purpose |
|---|---|---|
| `BASE_URL` | `http://localhost:$PORT` | Public origin with no trailing slash. The ACS URL is `${BASE_URL}/saml/acs`. The default entity ID is `${BASE_URL}/saml/metadata`. An `https://` value also turns on the `Secure` cookie flag. |
| `PORT` | `8080` | Listen port. The container image sets `8080`. |
| `APP_NAME` | `Okta Test App` | Text in the page header and title. |
| `DATA_DIR` | `./data` | Directory for `db.json`. The image sets `/data`. |
| `SESSION_SECRET` | random at startup | Signs the session cookie. A random value invalidates sessions on every restart. Set a stable secret in any deployed environment. |
| `SAML_IDP_METADATA_URL` | empty | Okta metadata URL. Preferred way to configure SAML. Fetched once at startup. |
| `SAML_IDP_SSO_URL` | empty | Manual SSO URL when you are not using metadata. |
| `SAML_IDP_CERT` | empty | Manual signing certificate. PEM or the base64 body both work. |
| `SAML_IDP_ISSUER` | empty | Manual IdP issuer. With metadata, the entity ID in the metadata is used unless this is set. |
| `SAML_SP_ENTITY_ID` | `${BASE_URL}/saml/metadata` | Audience / SP entity ID. Must match Okta's Audience URI exactly. |
| `SAML_WANT_ASSERTIONS_SIGNED` | `true` | Reject assertions that are not signed. |
| `SAML_WANT_RESPONSE_SIGNED` | `false` | Also require the outer `<Response>` to be signed. |
| `SAML_FORCE_AUTHN` | `false` | Send `ForceAuthn="true"` on SP-initiated logins so Okta re-runs the authentication policy. |
| `SAML_AUTHN_CONTEXT` | empty | Comma-separated `AuthnContextClassRef` values to request. Empty means the request does not ask for a class. |
| `SCIM_TOKEN` | empty | Bearer token Okta sends for SCIM. Empty disables `/scim/v2` (HTTP 503). |
| `REQUIRE_SCIM_USER` | `false` | After a valid assertion, deny users who are missing or inactive in the SCIM store. |
| `ADMIN_USERS` | empty | Comma-separated emails or usernames allowed into `/admin`. Empty allows every signed-in user. |

Generate the two secrets with:

```bash
openssl rand -hex 32
```

## Which variables the Lightsail script sets

`deploy/lightsail.sh` persists and forwards:

- `SCIM_TOKEN`
- `SESSION_SECRET`
- `SAML_IDP_METADATA_URL`
- `REQUIRE_SCIM_USER`
- `ADMIN_USERS`
- `SAML_FORCE_AUTHN`
- `BASE_URL` (taken from the service URL, not from your shell)

It also records `SERVICE_NAME`, `AWS_REGION`, and `POWER` in `.deploy.env` for the next run. Those three are not container environment variables.

Empty values are omitted. `REQUIRE_SCIM_USER=false` and `SAML_FORCE_AUTHN=false` are sent because they are non-empty.

`SAML_AUTHN_CONTEXT`, `SAML_WANT_RESPONSE_SIGNED`, `SAML_SP_ENTITY_ID`, `APP_NAME`, and the manual IdP variables are not forwarded. Set those by editing the environment block in `deploy/lightsail.sh`, or by deploying the image yourself (ECS, for example) and setting the variables on the task.

## Metadata URL versus manual IdP settings

Use the metadata URL. It carries the issuer, SSO endpoint, and signing certificate, including extra certificates Okta publishes during a rollover.

Use the manual trio only when the app cannot fetch the metadata URL at startup (no outbound HTTPS). You need both `SAML_IDP_SSO_URL` and `SAML_IDP_CERT`. Set `SAML_IDP_ISSUER` to the IdP entity ID from Okta (`http://www.okta.com/<app id>`).

## Cookies and `BASE_URL`

`BASE_URL` is the origin users type in the browser. It has to be the URL Okta posts to. Trailing slashes are stripped.

If the site is served over HTTPS and `BASE_URL` is still `http://...`, the session cookie will not be marked `Secure`, and the ACS URL you give Okta will be wrong. Set `BASE_URL` to the `https://` origin before testing login.
