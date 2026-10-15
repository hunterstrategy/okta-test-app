# Local development

Node.js 22 or newer is required (`package.json` `engines`). The production image uses Node 24.

```bash
npm install
cp .env.example .env
# set SCIM_TOKEN and SESSION_SECRET at least
npm start
```

`npm start` runs `node src/server.js`. To load `.env` the way the README historically did:

```bash
node --env-file=.env src/server.js
```

The app listens on port 8080 unless `PORT` is set. Open `http://localhost:8080`. Until `SAML_IDP_METADATA_URL` (or the manual SSO URL and certificate) is valid, the home page reports that SAML is not ready and `/login` returns 503. SCIM returns 503 until `SCIM_TOKEN` is set.

## Tests

```bash
npm test
```

`test/app.test.js` starts the server against a throwaway data directory and a fixture IdP certificate. It checks:

- SP metadata contains the entity ID and ACS URL
- `/login` redirects to the fixture SSO URL with a `SAMLRequest`
- SCIM rejects a bad bearer token
- With `REQUIRE_SCIM_USER=true`, an unknown user is denied
- The user create, filter, PUT, and PATCH sequence Okta sends
- A provisioned user can complete IdP-initiated and SP-initiated logins
- A tampered assertion is rejected
- Group member add/remove and user deactivation
- Parsing an Okta-style IdP metadata document

The fixture key and certificate under `test/fixtures/` exist only for this test. Do not use them as a real IdP.

## What you can exercise on localhost

SAML ACS is a browser POST to the URL configured in Okta. A local server can receive that POST. Okta's Single sign-on URL field expects an `https://` URL on a real org, so day-to-day SSO testing belongs on the deployed origin.

SCIM is called by Okta's servers, not by the browser. Okta cannot reach `http://localhost:8080`. Point provisioning at the deployed base URL.

A tunnel (ngrok, Cloudflare Tunnel, or similar) works if you set `BASE_URL` to the public `https://` origin and use that same origin in the Okta app. Restart the process after changing `BASE_URL` or the metadata URL.

## Data

Local runs write `./data/db.json` (gitignored). Delete that file to wipe users, groups, and logs.
