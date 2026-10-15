# Integrate with Okta

This walks through a Workforce Identity org: a SAML 2.0 app, SCIM provisioning, and an authentication policy you can use to require a phishing-resistant factor. The app records the assertion and the SCIM pushes. It does not enforce a factor on its own. Okta does that before it issues the assertion.

You need:

- Okta administrator access that can create applications and, for SCIM, an org licensed for provisioning
- The public base URL of a running app, with no trailing slash
- The SCIM bearer token (`SCIM_TOKEN` from `.deploy.env` on Lightsail, or the Secrets Manager value on ECS)

Do the steps in order. SAML metadata is a round trip: Okta needs the app's ACS URL before it will show a metadata URL, and this app needs that metadata URL before `/login` works. SCIM can be connected as soon as the base URL and token exist, including before SAML is configured.

## 1. Deploy the app far enough to have a URL

On Lightsail, run `./deploy/lightsail.sh` once and wait for `RUNNING`. Copy the four values it prints:

| Okta field | Value |
|---|---|
| Single sign-on URL | `https://<app-url>/saml/acs` |
| Audience URI (SP Entity ID) | `https://<app-url>/saml/metadata` |
| SCIM connector base URL | `https://<app-url>/scim/v2` |
| SCIM bearer token | the hex `SCIM_TOKEN` |

Confirm `curl https://<app-url>/healthz` returns `"ok":true`. `"saml":false` is expected until step 4.

## 2. Create the SAML application

1. In the Okta Admin Console, go to **Applications > Applications**.
2. Click **Create App Integration**.
3. Select **SAML 2.0**. Click **Next**.
4. **General Settings.** Set the app name (for example `Okta Test App`). Leave the icon visible if you want to test the dashboard tile. Click **Next**.

## 3. Fill in the SAML settings

On **Configure SAML**, set:

| Field | Value |
|---|---|
| Single sign-on URL | `https://<app-url>/saml/acs` |
| Use this for Recipient URL and Destination URL | checked |
| Audience URI (SP Entity ID) | `https://<app-url>/saml/metadata` |
| Default RelayState | empty |
| Name ID format | `EmailAddress` |
| Application username | `Okta username` |
| Update application username on | Create and update |

Leave **Response** and **Assertion** signature algorithm on the defaults (RSA-SHA256). Leave **Assertion Encryption** off. This app does not publish an encryption certificate.

The audience string is also the SP metadata URL. It must match character for character, including `https://` and with no trailing slash. If you set `SAML_SP_ENTITY_ID` on the server, use that value as the Audience URI instead.

Name ID format `EmailAddress` plus application username `Okta username` makes the assertion's NameID the person's Okta username. SCIM uses that same value as `userName`. `REQUIRE_SCIM_USER` looks up NameID first, then the `email` attribute. Keep these two aligned. A custom username transform on one side and not the other produces a valid assertion that the app rejects as "not provisioned".

### Attribute statements

These are optional. They show up on the home page after login. Add them under **Attribute Statements**:

| Name | Name format | Value |
|---|---|---|
| `email` | Unspecified | `user.email` |
| `firstName` | Unspecified | `user.firstName` |
| `lastName` | Unspecified | `user.lastName` |

To see which factors Okta used, add:

| Name | Name format | Value |
|---|---|---|
| `amr` | Unspecified | `session.amr` |

`session.amr` is an Okta expression for the current session's authentication method references. Okta documents it in [Pass Dynamic Authentication Context](https://help.okta.com/en-us/content/topics/apps/pass-authn-context.htm). A password plus Okta Verify commonly arrives as several values, such as `pwd`, `mfa`, and `swk`. A hardware-secured key can arrive as `hwk`. The home page prints every value with the other attributes. Okta's System Log is still the record of whether a policy required a phishing-resistant factor. `AuthnContextClassRef` in the assertion is usually `urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport` no matter which factor was used.

### Group attribute statement

Optional. Under **Group Attribute Statements**:

| Name | Name format | Filter |
|---|---|---|
| `groups` | Unspecified | Matches regex `.*` |

That list is only on the home page for that login. Membership in the admin console comes from SCIM group push (step 8), not from this attribute.

Click **Next**.

## 4. Finish the wizard and send Okta's metadata to the app

1. On the feedback step, select **I'm an Okta customer adding an internal app**.
2. App type: you can check both "This is an internal app that we have created" boxes, or leave them as fits your org. Click **Finish**.
3. Open the app's **Sign On** tab.
4. Under **SAML 2.0**, find **Metadata URL**. It looks like `https://YOUR-ORG.okta.com/app/XXXXXXXX/sso/saml/metadata`. Copy the whole URL.
5. Redeploy so the app fetches it at startup.

Lightsail:

```bash
SAML_IDP_METADATA_URL="https://YOUR-ORG.okta.com/app/XXXXXXXX/sso/saml/metadata" \
  ./deploy/lightsail.sh
```

Wait until the service is `RUNNING`, then:

```bash
curl -fsS https://<app-url>/healthz
```

`"saml":true` means the metadata loaded. On ECS, put the same URL in the task definition and roll the service.

The metadata URL is not a secret, but it is specific to this Okta app. If you rotate the IdP signing certificate in Okta, restart the app so it fetches metadata again.

You can ignore "View SAML setup instructions" if you have the metadata URL. Those instructions are the manual alternative (`SAML_IDP_SSO_URL`, `SAML_IDP_CERT`, `SAML_IDP_ISSUER`). The certificate there is the body between the PEM markers.

## 5. Assign people

1. Open the app's **Assignments** tab.
2. Click **Assign > Assign to People** or **Assign to Groups**.
3. Assign the account you will test with. Click **Done**.

Assignment is what lets Okta offer the app and, once provisioning is on, what causes a SCIM create. Save this until after step 7 if you want the first assignment to provision immediately. Assigning before SCIM is enabled is fine; Okta provisions when you later enable "Create Users" and the assignment already exists.

## 6. Enable the SCIM connector

Skip this section if you only want SAML. Leave `REQUIRE_SCIM_USER` unset or `false`. Anyone Okta will issue an assertion for can sign in.

If the org has no provisioning feature, **General > App Settings** will not offer SCIM. SSO still works.

1. Open the app's **General** tab.
2. Under **App Settings**, click **Edit**.
3. For **Provisioning**, choose **SCIM**. **Save**.

A **Provisioning** tab appears.

4. Open **Provisioning > Integration**. Click **Edit**.
5. Set:

| Field | Value |
|---|---|
| SCIM connector base URL | `https://<app-url>/scim/v2` |
| Unique identifier field for users | `userName` |
| Supported provisioning actions | Import New Users and Profile Updates, Push New Users, Push Profile Updates, Push Groups |
| Authentication Mode | HTTP Header |
| Authorization | the `SCIM_TOKEN` value only |

Paste the hex token into **Authorization**. Do not type the word `Bearer`. Okta adds the `Bearer ` prefix. The app compares the token after stripping that prefix.

6. Click **Test Connector Configuration**. Okta calls the SCIM discovery endpoint. You should see a success message listing Users and Groups. **Save**.

A failure here is almost always the base URL (path must end in `/scim/v2`), a token mismatch, or the deployment not being `RUNNING` yet. The app returns 401 for a wrong token and 503 if `SCIM_TOKEN` is empty. Both show up in the Lightsail or ECS logs as SCIM lines, and 401s are stored in the SCIM request log once you can open `/admin`.

## 7. Push users

1. Open **Provisioning > To App**. Click **Edit**.
2. Enable:
   - **Create Users**
   - **Update User Attributes**
   - **Deactivate Users**
3. Leave password sync off. This app reports `changePassword` unsupported.
4. **Save**.

Okta then creates a SCIM user for each current assignment. Profile edits and unassignment follow.

5. Open **Provisioning > To App** and confirm the assignments are not showing an error. A green push, or a user row without an error, is what you want.

6. Sign in to the app once SAML is healthy (step 9) and open `/admin`. The user should be listed under **SCIM users** as active. The **SCIM request log** shows `POST /Users` and the later `GET` filters.

Attribute mappings live under **Provisioning > To App > Attribute Mappings** (Okta labels this section beside the To App settings). The defaults map Okta username to `userName` and the name parts onto `name.givenName` and `name.familyName`. Leave those defaults unless you have a reason to change `userName`.

## 8. Push a group

1. Open the app's **Push Groups** tab.
2. Click **Push Groups** and find the Okta group by name.
3. Push it. If you want members to be created as users, they also need to be assigned to the app. Group push updates membership; the user create still comes from an assignment plus **Create Users**.

In `/admin`, the group appears under **SCIM groups** with a member count, and each member's row lists the group name.

To remove someone, unassign them or deactivate them in Okta. With **Deactivate Users** enabled, Okta PATCHes `active` to false. The admin page shows the user as inactive. With `REQUIRE_SCIM_USER=true`, that person's next login gets **403** and the message "User is deactivated in SCIM".

## 9. Sign in from the app

1. Confirm `https://<app-url>/healthz` reports `"saml":true`.
2. Open `https://<app-url>/login` in a browser.
3. Complete the Okta prompt.
4. You land on `/`. A successful page shows **Authenticated via SAML**, the NameID, `AuthnContextClassRef`, `AuthnInstant`, **SP-initiated (/login)**, and the attribute statements from step 3.

Open `/admin`. **Recent sign-ins** should show a row with result **ok**.

If `ADMIN_USERS` is set, the NameID or `email` attribute must be on that list. Otherwise `/admin` is 403 Forbidden while `/` still works.

## 10. Sign in from the Okta dashboard

1. In the Okta end-user dashboard (not the admin console), click the app tile.
2. Okta POSTs straight to `/saml/acs`. The home page **Flow** line reads **IdP-initiated (Okta dashboard)**.

The app accepts this because it does not require `InResponseTo`. Default RelayState must stay empty. A relay value you type in Okta is ignored for routing unless it starts with `sp:`, which is the prefix `/login` adds itself.

## 11. Require a provisioned user

Redeploy or roll the task with `REQUIRE_SCIM_USER=true`.

Then:

- An assigned, active, pushed user signs in as in step 9.
- A user who can authenticate at Okta but was never pushed gets a valid assertion and then **403** "User has not been provisioned via SCIM". The attempt is in **Recent sign-ins** as a failure.
- A deactivated SCIM user gets **403** "User is deactivated in SCIM".

SAML still has to succeed before that check runs. A person who fails the Okta policy never hits the app.

## 12. Require a phishing-resistant factor

Create a policy Okta evaluates before it issues the assertion.

1. Go to **Security > Authentication Policies**.
2. Create a policy, or add a rule on the policy you will attach to this app.
3. On the rule, require a possession factor and set the constraint to **Phishing resistant**. In the current policy editor that is a possession-factor requirement with the phishing-resistant constraint. Factors that satisfy it include Okta FastPass when it is phishing resistant, a FIDO2/WebAuthn security key, and a smart card. Passwords, SMS, and ordinary OTP do not.
4. Save the rule. Put it above any catch-all rule that would allow a weaker factor.
5. On the app's **Sign On** tab, set the authentication policy (sometimes labeled user authentication) to this policy. Save.

Policy denial is decided at Okta. The browser stays on Okta's error page. This app's sign-in log does not get a row. Use **Reports > System Log** in Okta and filter on the user and this application.

### Make every `/login` re-run the policy

Okta will reuse an existing session when the user opens `/login`, so a weak session from earlier in the day can skip the new rule. Redeploy with:

```bash
SAML_FORCE_AUTHN=true ./deploy/lightsail.sh
```

Keep `SAML_IDP_METADATA_URL` as already saved in `.deploy.env`; you only need to pass values you are changing. The script sends `ForceAuthn="true"` on the SP-initiated request. The dashboard tile is IdP-initiated and does not include that flag. Sign out of Okta, or use a private window, when you test the tile.

`SAML_AUTHN_CONTEXT` can request a class reference, but Okta still reports `PasswordProtectedTransport` in `AuthnContextClassRef` for typical org policies. Use the authentication policy plus System Log, and `session.amr` on the home page, when you need to see the factor. Do not treat `AuthnContextClassRef` as proof of a phishing-resistant authenticator.

## 13. Restrict `/admin`

```bash
ADMIN_USERS="you@example.com,other@example.com" ./deploy/lightsail.sh
```

Comparison is case-insensitive against NameID and the `email` attribute. An empty `ADMIN_USERS` allows every signed-in user, which is the default.

## 14. What to look at after a test

| Question | Where |
|---|---|
| Did Okta issue an assertion? | Home page after redirect, or **Recent sign-ins** in `/admin` |
| Which flow was it? | Home page **Flow**, or the sign-in detail column |
| What attributes arrived? | Home page **Attribute statements** |
| What did the signed XML contain? | Home page **Raw assertion** |
| Was the user pushed? | `/admin` **SCIM users** |
| What did Okta send over SCIM? | `/admin` **SCIM request log**, including the request body |
| Why did Okta refuse to sign in? | Okta **System Log**, not this app |
| Why did the app reject a good Okta login? | The 401 or 403 page text, and **Recent sign-ins** |

`/logout` on this app clears only the local cookie. It does not send SAML logout to Okta.

## Field cheat sheet

```text
Single sign-on URL:          https://<app-url>/saml/acs
Audience URI:                https://<app-url>/saml/metadata
Name ID format:              EmailAddress
Application username:        Okta username
SCIM connector base URL:     https://<app-url>/scim/v2
Unique identifier:           userName
Authentication Mode:         HTTP Header
Authorization:               <SCIM_TOKEN>
```
