# Local development

You do not need this page to deploy the website or to connect Okta. Use it when you are changing the code on a Windows PC.

The production container uses Node 24. Your PC needs Node.js 22 or newer. The Windows installer is on [https://nodejs.org](https://nodejs.org). Leave **Add to PATH** checked. Close and reopen PowerShell after installing.

## Run the website on your PC

1. Open PowerShell.
2. Go to the project folder:

```powershell
cd C:\path\to\okta-test-app
```

3. Install the libraries once:

```powershell
npm install
```

4. Copy the sample settings:

```powershell
Copy-Item .env.example .env
notepad .env
```

5. In Notepad, set `SCIM_TOKEN` and `SESSION_SECRET`. You can generate a value in PowerShell:

```powershell
-join ((1..32 | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) }))
```

Paste a different value into each of those two lines. Save the file.

6. Start the site:

```powershell
node --env-file=.env src/server.js
```

7. Open [http://localhost:8080](http://localhost:8080).

Until `SAML_IDP_METADATA_URL` in `.env` is a real Okta metadata URL, the home page says SAML is not ready and `/login` returns **SAML not configured**. That is expected. `/scim/v2` returns 503 until `SCIM_TOKEN` is set.

Stop the site with Ctrl+C in that PowerShell window.

## What you can and cannot test from localhost

Okta's sign-in form in a real org expects the Single sign-on URL to be an `https://` address Okta can name. Day-to-day sign-in testing belongs on the AWS address from [Deploy on AWS](aws.md).

User sync is called by Okta's servers. Okta cannot reach `http://localhost:8080`. Point the Okta SCIM base URL at the deployed website.

A tunnel such as ngrok can publish your PC if you set `BASE_URL` in `.env` to the tunnel's `https://` address and use that same address in the Okta app. Restart `node` after you change `.env`. The AWS website is the simpler place to test.

## Run the tests

From the project folder:

```powershell
npm test
```

The tests start the program against a temporary data folder and a fake Okta certificate that lives in `test\fixtures`. They check the metadata page, the redirect to a fake sign-in URL, rejection of a bad SCIM token, rejection of an unknown user when synced users are required, the user create/update calls Okta makes, a successful sign-in, rejection of a tampered message, group membership, and deactivation.

The certificate in `test\fixtures` is only for that test. Do not paste it into Okta or into `.env`.

## Local data

Runs on your PC write `data\db.json`. That folder is not part of git. Delete the file to clear local users, groups, and logs.
