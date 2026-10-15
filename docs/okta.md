# Integrate with Okta

Do this after the website is on AWS and `/healthz` shows `{"ok":true,"saml":false}`. The AWS steps are in [Deploy on AWS](aws.md).

You need an Okta administrator account that can create applications. Provisioning (the user-sync part) also has to be included in your Okta subscription. If you never see a provisioning option, you can still test sign-in. Skip the provisioning sections and leave `REQUIRE_SCIM_USER` unset.

Have Notepad open with the four values from the deploy script:

```text
Public website address:      https://okta-test-app.abc123.us-east-1.cs.amazonlightsail.com
Single sign-on URL:           that address + /saml/acs
Audience URI:                 that address + /saml/metadata
SCIM connector base URL:      that address + /scim/v2
SCIM token:                   the long hex string
```

There is no slash at the end of the public website address. Copy values from Notepad. Typing them by hand is the usual way to get a mismatch.

## The order

1. Create the Okta app and paste the website's two SAML addresses.
2. Copy Okta's Metadata URL.
3. Return to [Give the website Okta's address](aws.md#give-the-website-oktas-address) and deploy again.
4. Refresh `/healthz` until it says `"saml":true`.
5. Come back here. Assign a person, turn on user sync, and sign in.

Deploy the second time before you assign people. That deploy replaces the website and clears any users already pushed.

## 1. Open the Okta Admin Console

1. Sign in to Okta.
2. If you land on the end-user dashboard (a grid of app icons), click **Admin** so you are in the Admin Console. The address usually looks like `https://yourcompany-admin.okta.com` or `https://yourcompany.okta.com/admin`.
3. In the left menu, click **Applications**, then **Applications** again.

## 2. Create the application

1. Click **Create App Integration**.
2. Select **SAML 2.0**. Click **Next**.
3. On **General Settings**, set **App name** to `Okta Test App`. Leave the icon visible so you can click it from the Okta dashboard later. Click **Next**.

You are now on **Configure SAML**. Fill in the fields below. Leave every other field at its default.

| Field on the Okta form | Paste or choose this |
|---|---|
| Single sign-on URL | your Single sign-on URL, ending in `/saml/acs` |
| Use this for Recipient URL and Destination URL | checked |
| Audience URI (SP Entity ID) | your Audience URI, ending in `/saml/metadata` |
| Default RelayState | leave empty |
| Name ID format | `EmailAddress` |
| Application username | `Okta username` |
| Update application username on | `Create and update` |

**Single sign-on URL** is where the browser delivers the signed sign-in message. **Audience URI** is the name of this website, so Okta will not hand that message to some other app. The two values are different. Both start with `https://` and neither has a space or a trailing slash.

**Name ID format** `EmailAddress` and **Application username** `Okta username` put the person's Okta username into the sign-in message. User sync uses that same value as the username. Keep these two dropdowns as shown so the sign-in name and the synced user name match.

Leave the signature algorithm dropdowns on RSA-SHA256. Leave assertion encryption off. This website does not have an encryption certificate.

### Add the fields the home page will show

Still on **Configure SAML**, find **Attribute Statements (optional)**. Click **Add Another** for each row.

| Name | Name format | Value |
|---|---|---|
| `email` | Unspecified | `user.email` |
| `firstName` | Unspecified | `user.firstName` |
| `lastName` | Unspecified | `user.lastName` |
| `amr` | Unspecified | `session.amr` |

The first three print the person's email and name. `amr` prints which methods Okta used for this sign-in. A password plus Okta Verify often shows `pwd`, `mfa`, and `swk`. A hardware security key can show `hwk`. Okta's own write-up of this field is [Pass Dynamic Authentication Context](https://help.okta.com/en-us/content/topics/apps/pass-authn-context.htm).

Optional, under **Group Attribute Statements**:

| Name | Name format | Filter |
|---|---|---|
| `groups` | Unspecified | Matches regex, value `.*` |

That group list appears on the home page for that sign-in only. The group list on the Admin page comes from group push later in this guide.

Click **Next**.

## 3. Finish the wizard

1. Select **I'm an Okta customer adding an internal app**.
2. You can check the box that says this is an internal app you created. Click **Finish**.

## 4. Copy Okta's Metadata URL

1. Open the app's **Sign On** tab.
2. Scroll to the **SAML 2.0** section.
3. Find the link named **Metadata URL**. Right-click it and choose **Copy link address**.

The link looks like:

```text
https://yourcompany.okta.com/app/xxxxxxxx/sso/saml/metadata
```

Paste it into Notepad on the "Okta metadata URL" line. Copy the link itself. If you open the link you will see a page of XML. That XML is what the website will download. You still paste the address, not the XML, into the deploy command.

4. Switch back to [Give the website Okta's address](aws.md#give-the-website-oktas-address) and run that deploy.
5. In the browser, refresh `https://your-website/healthz`.

Stop here until the page shows:

```text
{"ok":true,"saml":true}
```

Then continue.

## 5. Assign the person who will test

1. In the Okta app, open the **Assignments** tab.
2. Click **Assign**, then **Assign to People**.
3. Click **Assign** next to your test account, then **Save and Go Back**, then **Done**.

This lets Okta offer the app to that person. It also, once provisioning is on, tells Okta to create the user on the website.

## 6. Turn on user sync (SCIM)

Skip this whole section if you only want to test sign-in. Anyone Okta allows can then open the website.

1. Open the app's **General** tab.
2. In **App Settings**, click **Edit**.
3. Set **Provisioning** to **SCIM**. Click **Save**.

A **Provisioning** tab appears. If the dropdown has no SCIM choice, this Okta org is not licensed for provisioning. Sign-in still works. Stop this section.

4. Open **Provisioning**, then **Integration**. Click **Edit**.
5. Fill in:

| Field | Value |
|---|---|
| SCIM connector base URL | your SCIM connector base URL, ending in `/scim/v2` |
| Unique identifier field for users | `userName` |
| Supported provisioning actions | check all four: Import New Users and Profile Updates, Push New Users, Push Profile Updates, Push Groups |
| Authentication Mode | `HTTP Header` |
| Authorization | the SCIM token from Notepad |

Paste the token only. Do not type the word `Bearer` in front of it. Okta adds that word itself when it calls the website.

6. Click **Test Connector Configuration**.

Okta calls the website and should report that it found Users and Groups. Click **Save**.

If the test fails, check three things before changing anything else:

- The base URL ends in `/scim/v2` and uses `https://`.
- `/healthz` still shows `"ok":true` in your browser. If it does not, the AWS deploy is not `RUNNING` yet.
- The Authorization box is the token from `.deploy.env`, with no extra word and no space at the end.

A wrong token gets "401" from the website. An empty token on the server gets "503". Both are covered in [Troubleshooting](troubleshooting.md).

## 7. Tell Okta to create users on the website

1. Still under **Provisioning**, open **To App**.
2. Click **Edit**.
3. Turn on **Create Users**, **Update User Attributes**, and **Deactivate Users**.
4. Leave password sync off. This website does not store Okta passwords.
5. Click **Save**.

Okta now creates a user on the website for each person assigned to the app. A minute later you can confirm it, after your first successful sign-in, on the Admin page. The **SCIM users** table should list the person as active. The **SCIM request log** should show a `POST` to `/Users`.

Leave the attribute mappings at their defaults. Okta username maps to `userName`. Given name and family name map to the name fields. The username in that mapping must stay the same value as the SAML application username, or the website will treat a valid sign-in as an unknown person when you later require a synced user.

## 8. Sign in from the website

1. Open a browser window. A private window avoids an old Okta session.
2. Go to `https://your-website/login`.
3. Sign in at Okta with the person you assigned.
4. You land on the home page.

You should see **Authenticated via SAML** and these rows:

| Row | What a good result looks like |
|---|---|
| NameID | the person's Okta username |
| Flow | SP-initiated (/login) |
| SCIM | Provisioned and active, if you finished section 7. Otherwise "Not provisioned via SCIM" is still a successful sign-in. |
| Attribute statements | email, first name, last name, and `amr` if you added those rows |

5. Click **Admin** in the header.

**Recent sign-ins** should have a row with result **ok**. If you turned on user sync, **SCIM users** lists the person.

## 9. Sign in from the Okta dashboard

1. Open the Okta end-user dashboard. This is the icon grid, not the Admin Console. You can click your name and choose the dashboard, or open `https://yourcompany.okta.com`.
2. Click the **Okta Test App** icon.
3. The home page opens with **Flow** set to **IdP-initiated (Okta dashboard)**.

That is the dashboard-tile path. You do not visit `/login` first.

## 10. Push a group

1. In the Admin Console, open the app and click **Push Groups**.
2. Click **Push Groups**, search for an Okta group by name, and push it.

Members of that group also need to be assigned to the app if you want Okta to create them as users. Group push updates membership. **Create Users** is what creates the user records.

On the website Admin page, **SCIM groups** shows the group and a member count. Each user's row lists the group name.

To take someone off the website, unassign them in Okta or deactivate them in Okta. With **Deactivate Users** on, Okta marks them inactive. The Admin page shows inactive. Their next sign-in still reaches the website unless you turn on the setting in the next section.

## 11. Optional: only synced users may sign in

Do this when a valid Okta sign-in should still be rejected if that person is missing from the website's user list, or has been deactivated.

On the PC, in Git Bash, in the project folder:

```bash
REQUIRE_SCIM_USER=true ./deploy/lightsail.sh
```

Wait until Lightsail is `RUNNING` again. Then:

| Person | What the website does |
|---|---|
| Assigned, and the Admin page shows them active | Home page, signed in |
| Okta let them sign in, but they were never pushed | A page titled **Access denied**, text "User has not been provisioned via SCIM" |
| Admin page shows them inactive | **Access denied**, text "User is deactivated in SCIM" |

The denied attempts show on **Recent sign-ins** as failures. A person Okta itself rejected never appears there.

This deploy clears the user file. After it is `RUNNING`, re-save **Provisioning > To App** or reassign the test person so Okta creates them again before you test the "active user" row.

## 12. Optional: require a phishing-resistant factor

This policy is enforced by Okta, before Okta creates the sign-in message.

1. In the Admin Console, go to **Security**, then **Authentication Policies**.
2. Click **Add policy**. Name it `Phishing resistant test`. Add the Okta Test App on the policy's applications list if the form asks now. You can also attach it in step 5.
3. Open the policy and add a rule, or edit the default rule.
4. Set the rule so the person must use a possession factor, and set that factor's constraint to **Phishing resistant**.

The label in your org may be **User must authenticate with** and then a possession factor, with a constraint checkbox or dropdown named **Phishing resistant**. Factors that satisfy it include a FIDO2 security key, a passkey, Okta FastPass when your org has it set as phishing resistant, and a smart card. A password, a text message, or a normal one-time code does not satisfy that constraint.

5. Save the rule. If the policy has another rule that allows any factor, put the phishing-resistant rule above it. Okta uses the first rule that matches.
6. Open the app's **Sign On** tab. Find **User authentication** or **Authentication policy**. Choose `Phishing resistant test`. Save.

Test in a private browser window at `https://your-website/login`. Okta should ask for the strong factor. If Okta refuses, the browser stays on Okta. Open **Reports**, then **System Log**, and search for that user around the current time.

If `/login` does not prompt and just walks in, Okta is reusing a sign-in from earlier in the day. In Git Bash, in the project folder:

```bash
SAML_FORCE_AUTHN=true ./deploy/lightsail.sh
```

Wait for `RUNNING`, then try `/login` again in a private window. The dashboard icon does not send that "ask again" flag. For the icon test, sign out of Okta first or use a private window.

The home page can still show `PasswordProtectedTransport` in **AuthnContextClassRef** after a security-key login. Read the `amr` attribute on that same page, and read the System Log, to see the factor.

## 13. Optional: limit who can open Admin

By default every person who can sign in to the website can open `/admin`. To limit it, in Git Bash:

```bash
ADMIN_USERS="you@example.com,other@example.com" ./deploy/lightsail.sh
```

Use the same addresses they have as their Okta username. Comparison ignores capitalization. Someone who is signed in but not on the list can still see the home page. **Admin** returns **Forbidden**.

## 14. Where to look after a test

| You want to know | Look here |
|---|---|
| Did the website accept the sign-in? | The home page, or Admin → Recent sign-ins |
| Did the person start at the website or at the Okta icon? | Home page row **Flow** |
| Which name, email, and factor methods arrived? | Home page → Attribute statements |
| The exact signed message | Home page → Raw assertion → Show signed assertion XML |
| Did Okta create the user? | Admin → SCIM users |
| What did Okta send when it created or changed a user? | Admin → SCIM request log. Open **body** on that row. |
| Why did Okta refuse before the website was involved? | Okta Admin Console → Reports → System Log |
| Why did the website refuse after Okta succeeded? | The error page in the browser, and Admin → Recent sign-ins |

**Log out** on the website clears only the website's cookie. It does not sign the person out of Okta.

## Values to check if something does not match

```text
Single sign-on URL:          https://<website>/saml/acs
Audience URI:                https://<website>/saml/metadata
Name ID format:              EmailAddress
Application username:        Okta username
SCIM connector base URL:     https://<website>/scim/v2
Unique identifier:           userName
Authentication Mode:         HTTP Header
Authorization:               the SCIM token, with no extra text
```

`<website>` is the public address only, with no path and no final slash.
