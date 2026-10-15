# Okta Test App

This is a small website you host so you can watch what Okta does during sign-in. It is a test tool. It has no business features of its own. After someone signs in, the page shows the proof Okta sent. A separate Admin page lists the users and groups Okta created, and the recent sign-in attempts.

You will do two jobs:

1. Put the website on the internet with AWS. The steps are in [Deploy on AWS](docs/aws.md).
2. Tell Okta about that website. The steps are in [Integrate with Okta](docs/okta.md).

Do those two in that order. The AWS steps give you a public address. The Okta steps need that address. Then you come back to AWS once, to give the website Okta's address.

## Words used in these docs

| Word | What it means here |
|---|---|
| Okta | The sign-in system your users already have. Okta checks the password and any extra factor, such as a security key. |
| This website | The test app in this folder. It displays what Okta sent. It does not check passwords. |
| AWS | Amazon Web Services, the hosting account. These docs use Lightsail, which is the simple AWS way to run one website. |
| SAML | The sign-in message. Okta signs it. The website checks the signature and shows the contents. |
| ACS URL | The exact page where the browser delivers that sign-in message: your website address plus `/saml/acs`. |
| Audience (Entity ID) | A name both sides agree on, so the sign-in message is meant for this website. Here it is your website address plus `/saml/metadata`. |
| Metadata URL | A web address that publishes one side's SAML settings, including its certificate. You copy Okta's metadata URL into the website. |
| SCIM | The channel Okta uses to create, update, and disable user and group records on the website. |
| Bearer token | A long password Okta sends with every SCIM request. The website rejects SCIM calls that do not have it. |
| Container | The packaged copy of the website that AWS runs. You do not log in to a Windows server to install it. |

## How a sign-in works

```text
Person's browser          Okta                     This website
       |                    |                            |
       |---- open /login --------------------------->    |
       |                    |<----- "please sign in" ----|
       |---- password / security key at Okta ------->    |
       |<--- signed sign-in message (SAML) ---------|    |
       |---- deliver that message to /saml/acs --------->|
       |<--- home page showing what Okta sent -----------|
```

There is a second way in. The person opens their Okta dashboard (the page they see after signing in to Okta, not the Admin Console) and clicks this app's icon. Okta sends the same kind of signed message straight to `/saml/acs`. The home page labels that "IdP-initiated (Okta dashboard)". A login that started at `/login` is labeled "SP-initiated (/login)".

Okta decides whether the person is allowed to sign in, including whether they must use a phishing-resistant factor such as a FIDO2 security key. If Okta says no, the browser stays on an Okta error page. This website never sees that attempt. Look in Okta's System Log for those. This website's Admin page only lists attempts that reached the website.

## How users get onto the website

Assigning someone in Okta does not, by itself, type their name into this website. A second connection does that:

1. You turn on provisioning in the Okta app and paste the bearer token.
2. You assign the person to the Okta app.
3. Okta calls `https://your-website/scim/v2/Users` and sends the person's username, name, and email.
4. The website saves that record in a file on the server.
5. The Admin page lists them.

You can skip SCIM. Anyone Okta is willing to sign in can then open the website. Turn on the setting `REQUIRE_SCIM_USER` only when you want the website to refuse people who were not pushed, or who were later deactivated.

## What you see on the website

Replace `https://your-website` with the address AWS gives you.

| Open this | What it is |
|---|---|
| `https://your-website/` | Home. Signed-out visitors see a sign-in button. Signed-in visitors see Okta's username for them, the time Okta authenticated them, the extra fields you mapped, and the raw signed message. |
| `https://your-website/login` | Starts a sign-in at Okta. |
| `https://your-website/logout` | Signs the person out of this website only. Their Okta session in the browser stays signed in. |
| `https://your-website/admin` | Recent sign-ins, the users and groups Okta pushed, and a log of SCIM requests. Any signed-in person can open it unless you set `ADMIN_USERS`. |
| `https://your-website/healthz` | A one-line status check. `"ok":true` means the site is up. `"saml":true` means it successfully read Okta's metadata at startup. `"saml":false` means the site is up and Okta is not connected yet. |
| `https://your-website/saml/metadata` | The website's own SAML settings, as XML. You normally do not edit this. Okta's Audience field is this address. |
| `https://your-website/scim/v2` | The base address you paste into Okta for provisioning. A browser will not show a friendly page there. Okta's servers call it. |

The home page field `AuthnContextClassRef` will usually say `PasswordProtectedTransport` even when the person used a security key. That is how Okta fills that field. It does not prove which factor was used. Okta's System Log is the record of the factor. If you add the optional `amr` field in the Okta guide, the home page also lists the methods Okta reported for that session.

## How the app is built

One program serves every page. It is written in Node.js. The production package is a container that listens on port 8080 inside AWS. Lightsail puts HTTPS in front of that port and gives you a public address. You do not open port 8080 on your own PC.

| Piece | What it does |
|---|---|
| `src/server.js` | The pages: home, login, the SAML receiver, logout, admin |
| `src/saml.js` | Reads Okta's metadata when the program starts, then checks each sign-in message |
| `src/scim.js` | Receives user and group creates, updates, and deletes from Okta |
| `src/store.js` | Saves users, groups, and logs in one file, `db.json` |
| `src/config.js` | Reads the settings (the website address, the Okta metadata URL, the bearer token, and so on) |
| `src/views.js` | The HTML for the pages |
| `deploy/lightsail.sh` | The script that builds the container and publishes it to Lightsail |
| `Dockerfile` | The recipe for that container |

On startup the program reads Okta's metadata URL once and keeps the signing certificate in memory. If you change that URL, or if Okta rolls its certificate, run the deploy script again so the program starts over and reads the new settings.

Sign-in state is a cookie in the browser, valid for 8 hours. User records are in `db.json` on that one container's disk. Run a single copy. A second copy would have its own empty file and would not recognize the first copy's cookies. Every time you run the deploy script, AWS replaces the container and that file is gone. Okta can push the users again. The sign-in history on the Admin page starts over.

The longer version of this, including what the program checks on a sign-in message, is in [Architecture](docs/architecture.md). Every setting is explained in [Configuration](docs/configuration.md).

## Guides

| Read this | When |
|---|---|
| [Deploy on AWS](docs/aws.md) | You are ready to put the website on the internet from a Windows PC. Do this first. |
| [Integrate with Okta](docs/okta.md) | You have the public website address and the SCIM token written down. |
| [Troubleshooting](docs/troubleshooting.md) | A page, a script, or an Okta test failed and you want the matching fix. |
| [Configuration](docs/configuration.md) | You need to change a setting such as who can open Admin, or "only SCIM users may sign in". |
| [Architecture](docs/architecture.md) | You want the detail behind the diagram above. |
| [Local development](docs/local-development.md) | You are changing the code on your PC. You do not need this to deploy or to connect Okta. |

## Order of work

1. On a Windows PC, install Docker Desktop, the AWS CLI, Node.js, Git, and the Lightsail helper. [Deploy on AWS](docs/aws.md) has the installers and the clicks.
2. Run the deploy script once. Leave the window open until it prints **Values for Okta**. Copy those values into Notepad.
3. In a browser, open the website address plus `/healthz`. You want `{"ok":true,"saml":false}`. `saml` false is expected. Okta is not connected yet.
4. Create the Okta application in [Integrate with Okta](docs/okta.md). Stop when you have copied Okta's Metadata URL.
5. Run the deploy script a second time with that Metadata URL. Wait until `/healthz` shows `"saml":true`.
6. Go back to the Okta guide and turn on provisioning, assign a test person, and sign in.
7. If a step fails, use [Troubleshooting](docs/troubleshooting.md) before changing random fields.
