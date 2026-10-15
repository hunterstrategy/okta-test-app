# Architecture

Read [the README](../README.md) first. It explains what the website is for and how a sign-in moves between the browser, Okta, and this app. This page is the same system in more detail.

## One program, two jobs

The website is one Node.js program. It does two jobs for Okta and nothing else.

**Sign-in.** Okta checks the person. Okta's signed message comes back through the browser to the page `/saml/acs`. The program checks the signature, checks that the message names this website, checks the time, and then shows the contents. The program does not ask for a password.

**User sync.** Okta's servers call `/scim/v2` directly, with a bearer token, to create and update users and groups. The browser is not involved.

Those two jobs share one data file. They do not share a login. A person can be synced and still fail sign-in at Okta. A person can pass Okta and still be rejected by the website if you turned on "only synced users may sign in".

## The pages

| Path | Who calls it | What the program does |
|---|---|---|
| `/` | The browser | Shows the sign-in button, or the last accepted Okta message |
| `/login` | The browser | Sends the browser to Okta to start a sign-in |
| `/saml/acs` | The browser, carrying Okta's message | Checks the message and starts a session |
| `/saml/metadata` | You, or anyone | Returns this website's SAML name and ACS address as XML |
| `/logout` | The browser | Deletes the website session. Okta stays signed in |
| `/admin` | The browser, after a sign-in | Shows the log, users, and groups |
| `/scim/v2/...` | Okta's servers | Creates and updates users and groups |
| `/healthz` | AWS, and you | Returns `ok` and whether Okta's metadata loaded |

`/healthz` returns HTTP 200 even when Okta's metadata failed to load. AWS will keep the copy in service. Read the `saml` field. `true` means the metadata loaded. `false` means the process is up and Okta is not connected.

## What happens on startup

The program starts inside the container and reads its settings from environment variables. [Configuration](configuration.md) lists them.

If `SAML_IDP_METADATA_URL` is set, the program downloads that address once. From the XML it keeps:

- Okta's issuer name
- The sign-in URL it should send browsers to
- Okta's signing certificates

If that download fails, or the URL was never set, sign-in stays off. The process keeps running. `/login` shows **SAML not configured**. Fix the URL and start the process again. The program does not poll Okta for a new certificate later. A new deploy is how you pick up a change.

## What the program checks on a sign-in message

- The message is signed with a certificate it loaded from Okta.
- The audience in the message equals this website's entity ID, which is the public address plus `/saml/metadata`.
- The message was delivered to the ACS address, the public address plus `/saml/acs`.
- The time window in the message is valid, with 60 seconds of slack for clock differences.

A sign-in that started from the Okta dashboard is accepted. The program does not require the message to be a reply to a request it just sent.

`/login` marks its request so that, after success, the browser returns to the page the person wanted (usually the home page, or `/admin` if they clicked Admin while signed out). A sign-in from the Okta icon lands on the home page.

If `REQUIRE_SCIM_USER` is on, a message that passed every check above is still rejected unless the username in the message matches an **active** user in the data file.

`/logout` deletes the cookie for this website. The next `/login` will skip Okta's prompt if Okta still has a session, unless `SAML_FORCE_AUTHN` is on. That setting tells Okta to run the authentication policy again.

The program does not sign its own login request and does not publish a signing certificate. In the Okta SAML form, leave "signed requests" off.

## What user sync accepts

Every SCIM call must send `Authorization: Bearer` plus the token in `SCIM_TOKEN`. With no token configured, every SCIM call returns 503.

Okta uses these operations, and the program implements them:

| Address | Operations |
|---|---|
| `/ServiceProviderConfig` and `/ResourceTypes` | Read. This is what **Test Connector Configuration** calls. |
| `/Users` | List, search, create |
| `/Users/(id)` | Read, replace, partial update, delete |
| `/Groups` | List, search, create |
| `/Groups/(id)` | Read, replace, partial update, delete |

Search is one equality check, such as username equals `someone@example.com`, and it ignores capitalization. That is the search Okta sends. Other search syntax gets a 400.

Usernames must be unique, ignoring capitalization. Creating the same username twice returns 409.

Extra fields Okta sends on a user are stored and shown back. Password changes are refused. This website never stores the Okta password.

## The session and the Admin page

A successful sign-in replaces any old session and stores the username, the issuer, the time Okta authenticated the person, the attribute fields, the raw XML, which path was used (website or Okta icon), and whether a synced user matched.

The cookie name is `okta_test_sid`. It is HTTP-only, lasts 8 hours, and is marked Secure when the public address starts with `https://`.

`/admin` requires that cookie. If `ADMIN_USERS` is set, the username or the email attribute must be on that list. An empty list means every signed-in person can open Admin.

The Admin page shows the last 50 sign-ins and the last 50 SCIM calls. The file keeps 200 of each.

## Where the data lives

`db.json` is written under `DATA_DIR`. In the container that directory is `/data`. Nothing copies that file anywhere else. Replacing the container, which every Lightsail deploy does, starts from an empty file.

Run one copy. Two copies would each have their own users and their own sessions.

## The files

| File | Role |
|---|---|
| `src/server.js` | Routes, the session cookie, who may open Admin |
| `src/saml.js` | Load Okta metadata, check the sign-in message, read the fields |
| `src/scim.js` | The `/scim/v2` user and group API |
| `src/store.js` | Read and write `db.json` |
| `src/config.js` | Environment variables |
| `src/views.js` | HTML |
| `deploy/lightsail.sh` | Build the container and publish it to Lightsail |
| `Dockerfile` | Node 24, listens on 8080, health check hits `/healthz` |

The program trusts the proxy in front of it (Lightsail, or a load balancer on ECS) to tell it the original `https://` address.
