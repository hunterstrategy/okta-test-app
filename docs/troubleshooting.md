# Troubleshooting

## Health and startup

`curl https://<app-url>/healthz` returns `{"ok":true,"saml":false}`.

SAML did not initialize. The process is still up, which is why the load balancer marks it healthy. Read the container log for the `[saml]` line.

- `SAML is not configured` — `SAML_IDP_METADATA_URL` was empty at startup. Redeploy with the metadata URL.
- `Fetching IdP metadata failed: HTTP ...` — the URL is wrong, Okta returned an error, or the task has no outbound HTTPS. Copy the metadata URL again from the app's **Sign On** tab.
- `IdP metadata has no EntityDescriptor` / `no signing certificate` — the URL did not return Okta metadata. Browsing to it should show XML with `EntityDescriptor`.

After a successful load the log contains `[saml] ready. IdP SSO URL: ...` and health returns `"saml":true`. Changing the metadata URL has no effect until the process starts again.

`[config] SESSION_SECRET not set` means sessions will die on the next restart. On Lightsail, confirm `.deploy.env` contains `SESSION_SECRET` and redeploy.

## SAML login

**503 SAML not configured** on `/login`. Same causes as `"saml":false` above.

**Okta says the app is unavailable, or "A SAML response was received unexpectedly" / audience mismatch.** Compare Okta and the running app:

- Single sign-on URL equals the `ACS URL` row on `/admin` (or `[app] ACS URL` in the log).
- Audience URI equals the `SP Entity ID` row.
- Both use `https://` and the host people actually open.
- Recipient URL and Destination URL are the ACS URL (the checkbox in the SAML wizard).

A Lightsail redeploy keeps the same service URL. Changing `BASE_URL` on ECS without editing the Okta app produces this mismatch.

**401 SAML validation failed.** The page includes `node-saml`'s reason. Common ones:

- Invalid signature. The process is still using a certificate from before an Okta cert rollover. Restart so metadata is fetched again. If you configured `SAML_IDP_CERT` by hand, paste the current signing cert.
- Assertion audience does not match. Audience URI and `SAML_SP_ENTITY_ID` / default entity ID differ.
- Timestamps. The app allows 60 seconds of clock skew. A task with a bad clock fails `NotBefore` / `NotOnOrAfter`.
- `SAML_WANT_RESPONSE_SIGNED=true` while you turned response signing off in Okta, or the reverse if you set Okta to sign only the assertion and then require the response.

The failed attempt is listed in `/admin` **Recent sign-ins** when the POST reached the app. Sign in as someone who can, or check the log line `[saml] rejected response`.

**403 Access denied** after Okta accepted the password or factor. The assertion was valid and `REQUIRE_SCIM_USER=true` rejected it.

- "User has not been provisioned via SCIM" — no SCIM `userName` matches NameID or `email`. Check **SCIM users**. Confirm Okta application username and the SCIM `userName` mapping are the same value. Assign the user and confirm **Create Users** is enabled.
- "User is deactivated in SCIM" — the user exists and `active` is false. Reassign them or turn them active in Okta so a PATCH sets `active` back to true.

**Login succeeds but the authentication policy never prompts.** The Okta session is already satisfied. Redeploy with `SAML_FORCE_AUTHN=true` and use `/login`, or use a private window and sign out of Okta first. The dashboard tile does not send `ForceAuthn`. Also confirm the app's **Sign On** tab uses the policy you edited, and that the strict rule is ordered above a broader allow rule.

**The home page shows `PasswordProtectedTransport` after a FIDO2 login.** That is Okta's usual `AuthnContextClassRef`. Check System Log, and add a SAML attribute named `amr` with value `session.amr` if you want the method list on the home page. See [Okta integration](okta.md).

**`/admin` is 403.** `ADMIN_USERS` is set and neither NameID nor the `email` attribute is in the list. Attribute name `email` has to be the statement from the Okta app. NameID alone is enough when it is the email.

**Clicking the dashboard tile lands on `/` with IdP-initiated.** That is the expected result. SP-initiated is only `/login`.

## SCIM

**Test Connector Configuration fails.**

- Base URL is `https://<app-url>/scim/v2` with no extra path and no trailing slash beyond `v2`.
- Authentication mode is HTTP Header.
- The Authorization box is the raw token from `.deploy.env` or Secrets Manager. A second `Bearer ` prefix will not match.
- `/healthz` works from your machine. Okta's IPs must be able to reach the load balancer. A Lightsail service URL is public. An ALB security group that only allows your office IP will fail Okta's test.
- Token empty in the running container: SCIM returns 503 `SCIM is disabled`.

**Users never appear in `/admin`.**

- **Provisioning > To App > Create Users** is on.
- The user or group is on **Assignments**.
- The push row in Okta has no error. Okta's error text is the SCIM `detail` (for example `userName is required` or `User already exists`).
- You redeployed. The disk was wiped. Re-save provisioning or reassign so Okta pushes again.

**409 User already exists.** A user with that `userName` is already in `db.json`. Okta is retrying a create. Deactivate/reactivate from Okta, or delete `db.json` by redeploying and let Okta create again. Don't keep two Okta apps pointed at one token and one store unless the usernames are disjoint.

**Group push succeeds but member count stays 0.** Members who are not SCIM users yet are still stored as member ids when Okta sends them. If the count is 0, the push did not include members. Assign those people to the app so user provisioning runs, then push the group again.

**Import from Okta is empty.** Expected on a new deploy. This app starts with no users. Push from Okta; don't import.

## Lightsail deploy script

**`lightsailctl: command not found` or push fails immediately.** Install the plugin from the AWS Lightsail docs and put it on `PATH`. The AWS CLI does not include it.

**`Could not determine pushed image name`.** The push command's output did not contain `":okta-test-app.app.<n>"`. Read the push output above that line. The usual cause is a failed upload or a `SERVICE_NAME` that does not match the service.

**Service stays in `PENDING` or `DEPLOYING`.** First-time container services often take several minutes. Keep polling `get-container-services`. A deployment that never reaches `RUNNING` is in the deployment record in the Lightsail console, usually a failed health check. `/healthz` failing means the process did not stay up; read `get-container-log`.

**Docker build fails on Apple silicon.** The script targets `linux/amd64`. Start Docker Desktop and retry. You do not need a native arm64 image; Lightsail runs amd64.

## ECS

**Target group flips between healthy and unhealthy, or login only works sometimes.** Desired count is above 1, or a deploy is running two tasks. Set desired count to 1. Each task has its own memory session store and its own disk.

**Task is healthy and `"saml":false`.** The task definition revision that is running does not have `SAML_IDP_METADATA_URL`, or the private subnet has no NAT path to Okta. Exec into the logging story: the `[saml]` line says which.

**Cookies don't stick.** `BASE_URL` must start with `https://`. The ALB listener that users hit must be HTTPS. The HTTP listener should redirect, not serve the app.

## Still stuck

Collect three things: the `/healthz` JSON, the `[saml]` and `[app]` lines from startup, and the text of the 401/403 page or the Okta System Log event. Those distinguish "Okta never called us", "we rejected the assertion", and "we rejected the user after a good assertion".
