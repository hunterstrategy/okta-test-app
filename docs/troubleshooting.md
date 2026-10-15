# Troubleshooting

Match the sentence you see, then do the steps under it. The deploy commands assume Git Bash is open in the project folder. In File Explorer, right-click the folder background and click **Git Bash Here**. On Windows 11, choose **Show more options** first if you do not see that item. PowerShell commands are marked as PowerShell.

The website address below means the `https://....cs.amazonlightsail.com` address from the deploy script, with no path on the end.

## The browser

### `/healthz` shows `{"ok":true,"saml":false}`

The website process is up. It does not have Okta's settings yet, or it failed to download them.

1. If you have not copied Okta's Metadata URL and redeployed, this is expected. Continue at [Give the website Okta's address](aws.md#give-the-website-oktas-address).
2. If you already redeployed, wait until this PowerShell command prints `RUNNING`. A deploy still in progress is serving the old copy.

```powershell
aws lightsail get-container-services --service-name okta-test-app --query "containerServices[0].state" --output text
```

3. If it is `RUNNING` and `saml` is still false, read the log. In PowerShell:

```powershell
$end = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$start = $end - 3600
aws lightsail get-container-log --service-name okta-test-app --container-name app --start-time $start --end-time $end --query "logEvents[].message" --output text
```

| Line in the log | What to do |
|---|---|
| `SAML is not configured` | `.deploy.env` has an empty `SAML_IDP_METADATA_URL`. Run the second deploy with the URL in quotes. |
| `Fetching IdP metadata failed: HTTP` | The metadata URL is incomplete or Okta returned an error. In Okta, Sign On tab, right-click **Metadata URL**, copy the link address, and deploy again. |
| `IdP metadata has no EntityDescriptor` or `no signing certificate` | The URL is not Okta's metadata. Open the URL in a browser. You should see XML that contains `EntityDescriptor`. |

A good log contains `[saml] ready. IdP SSO URL:`. Changing the URL does nothing until the next deploy finishes and the process starts again.

### `/healthz` does not load at all

1. In PowerShell, check the state command above. `DEPLOYING` means wait. `PENDING` on a brand-new service can last several minutes.
2. Confirm you are using `https://` and the host from the script, not `http://localhost`.
3. If the state stays `DEPLOYING` for more than about 15 minutes, read the log. The process is crashing and the health check never passes.

### The home page says SAML not configured, or `/login` says that

Same cause as `"saml":false`. The website has not loaded Okta's metadata.

### Okta shows an error and you never reach the website

Okta rejected the sign-in, or the addresses in the Okta app do not match the running website.

1. In Okta, open the app, **Sign On**, and compare the SAML settings with the Admin page of the website (sign in first by another account if you can) or with the `[app] ACS URL` and `[app] Entity ID` lines in the log.
2. Single sign-on URL must be the website address plus `/saml/acs`.
3. Audience URI must be the website address plus `/saml/metadata`.
4. The checkbox **Use this for Recipient URL and Destination URL** must be checked.
5. Both values use `https://` and the same host you open in the browser.

A Lightsail redeploy keeps the same website address. If you change the public name (for example by moving to ECS), update both Okta fields to match.

Then open Okta **Reports → System Log**, set the time to the last 15 minutes, and find the user you tested. The event text is the reason Okta stopped.

### The website says SAML validation failed (401)

Okta did deliver a message, and the website rejected it. The page includes the reason. **Recent sign-ins** on `/admin` lists it too, if you can open Admin as someone else.

| Reason you see | What to do |
|---|---|
| Invalid signature | The website has an old Okta certificate. Redeploy so it downloads metadata again. This happens after Okta rolls its signing certificate. |
| Audience | The Audience URI in Okta and the entity ID in the log differ by a character. Compare them in Notepad. |
| Time, `NotBefore`, or `NotOnOrAfter` | The message is outside the allowed window. The website allows 60 seconds of clock difference. |

### The website says Access denied (403) after Okta accepted you

The sign-in message was valid, and `REQUIRE_SCIM_USER` is on.

| Text on the page | What to do |
|---|---|
| User has not been provisioned via SCIM | Admin → SCIM users does not list this username. In Okta, assign the person, turn on **Create Users**, and wait for a `POST /Users` in the SCIM request log. The Okta username and the synced `userName` must be the same address. |
| User is deactivated in SCIM | The user is listed as inactive. Reassign them or reactivate them in Okta so Okta sends an update that sets them active. |

### You signed in, but Okta did not ask for the security key

Okta reused a session from earlier. Deploy with the ask-again setting and use a private window:

```bash
SAML_FORCE_AUTHN=true ./deploy/lightsail.sh
```

Then open `https://your-website/login`. Also confirm the app's **Sign On** tab uses the policy you edited, and that the strict rule is above any rule that allows a password alone.

The dashboard icon does not send the ask-again flag. Sign out of Okta before testing the icon.

### The home page says PasswordProtectedTransport after you used a security key

That is the value Okta puts in **AuthnContextClassRef** for a normal org. It does not tell you the factor. Read the `amr` row under Attribute statements. If that row is missing, add the attribute in [Integrate with Okta](okta.md) (`amr` = `session.amr`) and sign in again. The System Log in Okta is the authoritative record.

### Admin says Forbidden

`ADMIN_USERS` is set, and this person's username is not on the list. The home page can still work. Either sign in as someone on the list, or deploy again with the right addresses:

```bash
ADMIN_USERS="you@example.com" ./deploy/lightsail.sh
```

### The Okta icon lands on the home page and says IdP-initiated

That is the correct result for the dashboard icon. SP-initiated appears when you start at `/login`.

## Okta's connector test and user list

### Test Connector Configuration fails

1. SCIM connector base URL is `https://` plus the website host plus `/scim/v2`.
2. Authentication Mode is **HTTP Header**.
3. Authorization is the token only. Open `.deploy.env` with `notepad .deploy.env` and copy the characters after `SCIM_TOKEN=`. No word `Bearer`, no quotes, no space.
4. `/healthz` opens in your browser. Okta's servers must be able to reach that same public address. A Lightsail address is public. An ECS load balancer that only allows your office IP will fail Okta's test even though your browser works.
5. If the website log shows SCIM 503, the running container has no token. Redeploy so `.deploy.env`'s `SCIM_TOKEN` is sent.

### Nobody appears under SCIM users

1. **Provisioning → To App → Create Users** is on.
2. The person is on the **Assignments** tab.
3. The assignment row in Okta has no red error. The error text is the website's reason, such as "userName is required" or "User already exists".
4. You deployed again after the push. That clears the file. Reassign the person or click **Save** on **To App** so Okta creates the user again.

### Okta says the user already exists (409)

The website already has that username. Okta is trying to create them a second time. Deactivate and reactivate the assignment in Okta, or redeploy to wipe the file and let Okta create them once. Point only one Okta app at a given website and token.

### The group pushed, and the member count is 0

Assign those people to the app so **Create Users** runs, then push the group again.

### Import in Okta shows no users

Expected on a new website. The file starts empty. Push from Okta to the website. Import would copy from the website into Okta, and there is nothing to copy yet.

## The deploy script on Windows

| What you see | What to do |
|---|---|
| `./deploy/lightsail.sh`: no such file | Git Bash is not in the project folder. `ls` should show `deploy` and `README.md`. |
| PowerShell rejects the `SAML_IDP_METADATA_URL=...` command | That line is Bash. Right-click the project folder and choose **Git Bash Here**. Run the deploy script there. |
| `docker` cannot connect | Start Docker Desktop. Wait until it says it is running. |
| `aws`, `node`, or `lightsailctl` is not recognized inside Git Bash | Install that tool, then close Git Bash and open it again. Check `aws --version`, `node --version`, and `lightsailctl` in the new window. |
| `Could not determine pushed image name` | The upload failed. Read the lines just above. Docker must be running and `lightsailctl` must be on PATH. |
| `AccessDenied` | The IAM user cannot call Lightsail. The message names the missing permission. |

`[config] SESSION_SECRET not set` in the website log means the container started without the secret from `.deploy.env`. Open that file, confirm the line is present, and run `./deploy/lightsail.sh` again with no extra arguments so it sends the saved values.

## ECS only

**The site works, then fails, then works.** The service is running more than one copy, or a deploy is mid-switch. Set the desired count to 1. Each copy has its own user file and its own cookies.

**The target is healthy and `/healthz` says `"saml":false`.** The running task definition has no `SAML_IDP_METADATA_URL`, or the task's subnet cannot open HTTPS to Okta. The log line `[saml]` says which.

**You sign in and the next click sends you back to the sign-in page.** `BASE_URL` has to start with `https://`. People must hit the load balancer's HTTPS listener. The HTTP listener should redirect to HTTPS.

## What to send if you are still stuck

Send these three things:

1. The exact text of `/healthz`.
2. The `[saml]` and `[app]` lines from the log.
3. Either the error page from the website, or a screenshot of the Okta System Log event.

Those separate "Okta never called the website", "the website rejected the sign-in message", and "the website rejected the person after a good message".
