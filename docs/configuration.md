# Configuration

Settings are environment variables. You rarely edit them by hand on the server. On Lightsail you set them by running `deploy/lightsail.sh` from Git Bash. The script stores your choices in `.deploy.env` in the project folder and sends them on the next deploy.

Open that file from Git Bash with:

```bash
notepad .deploy.env
```

Do not commit `.deploy.env`. It contains the SCIM token and the session secret.

On your own PC, for local runs only, the file is `.env`. See [Local development](local-development.md).

## Settings you will actually change

### Public website address (`BASE_URL`)

The `https://` address users type, with no slash at the end. The script fills this in from the Lightsail service address. You do not set it yourself on Lightsail.

The sign-in delivery page is that address plus `/saml/acs`. The audience name is that address plus `/saml/metadata`. When the address starts with `https://`, the sign-in cookie is marked Secure.

### Okta metadata URL (`SAML_IDP_METADATA_URL`)

The link you copy from the Okta app's **Sign On** tab. The program downloads it once, at startup, and learns Okta's sign-in address and signing certificate.

Set it with the second deploy in [Deploy on AWS](aws.md#give-the-website-oktas-address).

### SCIM token (`SCIM_TOKEN`)

The long hex string you paste into Okta's Authorization box. The first deploy generates it and saves it in `.deploy.env`. Later deploys keep the same value.

If this is empty, user sync returns 503 and Okta's connector test fails.

### Session secret (`SESSION_SECRET`)

Signs the browser cookie. The first deploy generates it. Keep it stable. If it changes, everyone is signed out of the website. You never paste this into Okta.

### Only synced users may sign in (`REQUIRE_SCIM_USER`)

`false` by default. Anyone Okta accepts can open the website.

Set `true` to reject a valid Okta sign-in when that username is missing from the synced user list, or when the synced user is inactive. The Okta guide has the test cases: [only synced users](okta.md#11-optional-only-synced-users-may-sign-in).

```bash
REQUIRE_SCIM_USER=true ./deploy/lightsail.sh
```

### Who can open Admin (`ADMIN_USERS`)

Empty by default, which means every signed-in person can open `/admin`.

Set a comma-separated list of usernames or emails. Comparison ignores capitalization. The program checks the sign-in username and the `email` attribute.

```bash
ADMIN_USERS="you@example.com,other@example.com" ./deploy/lightsail.sh
```

### Ask Okta to authenticate again (`SAML_FORCE_AUTHN`)

`false` by default. Okta may reuse a session that is already signed in, so a new policy never prompts.

`true` sends that request when the person uses `/login`. The Okta dashboard icon does not go through `/login`, so it does not send this flag.

```bash
SAML_FORCE_AUTHN=true ./deploy/lightsail.sh
```

## How a Lightsail change works

1. Open Git Bash in the project folder.
2. Put the new values in front of `./deploy/lightsail.sh` on one line.
3. Wait until the Lightsail service is `RUNNING`.
4. The previous values stay in `.deploy.env` unless you replace them.

Values you type in the command win over the file. The script then writes the merged result back to the file.

The script sends these into the container: `BASE_URL`, `SCIM_TOKEN`, `SESSION_SECRET`, `SAML_IDP_METADATA_URL`, `REQUIRE_SCIM_USER`, `ADMIN_USERS`, and `SAML_FORCE_AUTHN`.

It also records `SERVICE_NAME`, `AWS_REGION`, and `POWER` in `.deploy.env` for the next run. Those three choose the AWS service. They are not website settings.

These are not sent by the script: `SAML_AUTHN_CONTEXT`, `SAML_WANT_RESPONSE_SIGNED`, `SAML_SP_ENTITY_ID`, `APP_NAME`, and the manual Okta fields below. To use them on Lightsail, add them to the environment block inside `deploy/lightsail.sh`, or run the container yourself and set them there.

A value is treated as true only when it is `1`, `true`, `yes`, or `on`. Any other text, including `false`, is false. A typo in `SAML_WANT_ASSERTIONS_SIGNED` would turn signature checks off, because the default is on and an unrecognized word becomes false.

## The full list

| Variable | Default | What it does |
|---|---|---|
| `BASE_URL` | `http://localhost:8080` | Public address, no trailing slash. Builds the ACS URL and the audience. `https://` marks the cookie Secure. |
| `PORT` | `8080` | Port inside the container. The image already sets 8080. |
| `APP_NAME` | `Okta Test App` | Title in the page header. |
| `DATA_DIR` | `./data` locally, `/data` in the container | Folder for `db.json`. |
| `SESSION_SECRET` | a new random value each start, if unset | Signs the cookie. Set it, or sessions die on every restart. |
| `SAML_IDP_METADATA_URL` | empty | Okta metadata URL. Downloaded once at startup. |
| `SAML_IDP_SSO_URL` | empty | Manual Okta sign-in URL, if you are not using the metadata URL. |
| `SAML_IDP_CERT` | empty | Manual Okta signing certificate. Paste the certificate file or the base64 block. |
| `SAML_IDP_ISSUER` | empty | Manual Okta issuer. With metadata, the issuer inside the metadata is used unless this is set. |
| `SAML_SP_ENTITY_ID` | the public address plus `/saml/metadata` | Audience. Must match Okta's Audience URI exactly. |
| `SAML_WANT_ASSERTIONS_SIGNED` | `true` | Reject a sign-in message whose assertion is not signed. |
| `SAML_WANT_RESPONSE_SIGNED` | `false` | Also require the outer response to be signed. Okta signs it by default. Turn this on only if you want to require that. |
| `SAML_FORCE_AUTHN` | `false` | On `/login`, tell Okta to run the policy again. |
| `SAML_AUTHN_CONTEXT` | empty | Optional comma-separated class names to request from Okta. Leave empty. Okta's class in the message is a poor signal of which factor was used. |
| `SCIM_TOKEN` | empty | Bearer token for user sync. Empty disables `/scim/v2`. |
| `REQUIRE_SCIM_USER` | `false` | After a valid sign-in message, require an active synced user. |
| `ADMIN_USERS` | empty | Comma-separated list allowed into `/admin`. Empty allows every signed-in person. |

## When you would paste a certificate instead of a metadata URL

Use the metadata URL. It includes the issuer, the sign-in address, and the signing certificates, including extras Okta publishes while it rolls a certificate.

Use `SAML_IDP_SSO_URL`, `SAML_IDP_CERT`, and `SAML_IDP_ISSUER` together only when the website cannot download the metadata URL (no outbound HTTPS from the container). You need both the sign-in URL and the certificate. The issuer looks like `http://www.okta.com/` followed by the Okta app id. The Lightsail script does not send these three. Add them to the script's environment block or set them on an ECS task.
