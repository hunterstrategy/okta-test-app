# Deploy on AWS from a Windows PC

This guide publishes the test website to Amazon Lightsail. Lightsail gives you a public `https://` address. You do not buy a certificate, create a DNS name, or set up a load balancer.

Plan on about 45 minutes the first time, mostly installers and waiting. A Lightsail container at the smallest size (`nano`) is enough. Check the current price in the Lightsail console before you leave it running. It is on the order of a few dollars a month.

When you are done with this page the first time, you will have four values in Notepad. Take those to [Integrate with Okta](okta.md). You will return here once, in [Give the website Okta's address](#give-the-website-oktas-address), after Okta shows you a Metadata URL.

Skip [If your team already uses ECS](#if-your-team-already-uses-ecs) unless someone told you this website must run on ECS instead of Lightsail.

## What you are creating

AWS will run one copy of the website. The public address looks like:

```text
https://okta-test-app.abc123.us-east-1.cs.amazonlightsail.com
```

The letters in the middle are assigned by AWS. You will copy the real address from the script output. There is no disk you can keep. Each time you deploy, AWS throws away the user list and the sign-in history. That is fine for a test. Run the deploy that connects Okta before you start pushing users.

## Write these down as you go

Open Notepad now. You will fill this in.

```text
AWS region:                  us-east-1
Public website address:
Single sign-on URL:          (website address)/saml/acs
Audience URI:                (website address)/saml/metadata
SCIM connector base URL:     (website address)/scim/v2
SCIM token:
Okta metadata URL:           (you get this later, from Okta)
```

The SCIM token is a long string of letters and numbers. It is a password. Store it with the rest of your admin passwords. It is also saved in a file named `.deploy.env` in the project folder.

## 1. Confirm you can sign in to AWS

1. Open a browser and go to [https://console.aws.amazon.com](https://console.aws.amazon.com).
2. Sign in with the IAM user your company gave you. Use an IAM user, the account you were issued for daily work. The root account is the email that owns the whole AWS account. Leave that one unused.
3. In the top-right corner, note the region, for example **N. Virginia (us-east-1)**. The script uses the region you configure in the next steps. `us-east-1` is a safe default. Lightsail container services are not offered in every region. If a later step says the region does not support container services, switch this guide to `us-east-1`.

You need permission to create a Lightsail container service and to upload an image. If a later command answers `AccessDenied`, send that error to the person who owns the AWS account. The error names the missing permission.

## 2. Install Docker Desktop

Docker is the tool that packs the website into the container AWS will run.

1. Download Docker Desktop for Windows from [https://docs.docker.com/desktop/setup/install/windows-install/](https://docs.docker.com/desktop/setup/install/windows-install/).
2. Run the installer. If it offers to use WSL 2, accept that. WSL 2 is a Windows feature Docker needs. Restart the PC if the installer says to.
3. Start **Docker Desktop** from the Start menu. You can skip signing in to a Docker account.
4. Wait until the whale icon in the taskbar is steady and Docker says it is running. The first start can take a few minutes.

## 3. Install the AWS CLI

This is the `aws` command the deploy script uses.

1. Download the Windows 64-bit MSI from [Install the AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html). The file is named `AWSCLIV2.msi`.
2. Run it. Accept the default install location.
3. Close any PowerShell windows that were already open, then open a new one: Start menu, type `PowerShell`, press Enter.

Check:

```powershell
aws --version
```

You want a line that starts with `aws-cli/2`. If Windows says `aws` is not recognized, close PowerShell, open a new window, and try again. The installer adds `aws` to your PATH, and old windows do not see that change.

## 4. Install Node.js

The deploy script uses Node to build the settings it sends to AWS. You are not writing code.

1. Open [https://nodejs.org](https://nodejs.org) and download the Windows installer for the LTS version. It needs to be version 22 or newer. Current LTS is fine.
2. Run the installer. Leave **Add to PATH** checked.
3. Close PowerShell and open a new window.

```powershell
node --version
```

You want `v22` or a higher number.

## 5. Install Git, so you can open Git Bash

The deploy script is `deploy\lightsail.sh`. It is a Bash script. Windows PowerShell cannot run it. Git for Windows includes **Git Bash**, which can.

1. Download Git from [https://git-scm.com/download/win](https://git-scm.com/download/win) and run the installer.
2. Accept the defaults. You want the option that adds **Git Bash Here** to the right-click menu.
3. You do not need to create a GitHub account for this deploy.

## 6. Install the Lightsail helper program

`aws lightsail push-container-image` needs a small extra program named `lightsailctl`. The AWS CLI does not include it.

In PowerShell:

```powershell
New-Item -ItemType Directory -Force -Path C:\lightsailctl
Invoke-WebRequest -Uri "https://s3.us-west-2.amazonaws.com/lightsailctl/latest/windows-amd64/lightsailctl.exe" -OutFile "C:\lightsailctl\lightsailctl.exe"
```

Put that folder on your PATH:

1. Press the Windows key and type `environment variables`.
2. Open **Edit environment variables for your account**.
3. Under **User variables**, select **Path**, then click **Edit**.
4. Click **New** and type `C:\lightsailctl`.
5. Click **OK** until the windows are closed.

Close PowerShell and open a new window.

```powershell
lightsailctl
```

Windows may print usage text or a short error about arguments. Either one means the program was found. If Windows says `lightsailctl` is not recognized, the PATH edit did not apply. Open a brand-new PowerShell window and try again.

## 7. Give the AWS CLI your keys

The CLI needs an access key for your IAM user.

1. In the AWS console, type `IAM` in the search bar and open it.
2. Click **Users**, then click your user name.
3. Open the **Security credentials** tab.
4. Click **Create access key**.
5. Choose **Command Line Interface (CLI)**. Confirm the acknowledgment. Click **Next**, then **Create access key**.
6. Copy the **Access key** and the **Secret access key** into your password store. The secret is shown once. You can also click **Download .csv file**.

Back in a new PowerShell window:

```powershell
aws configure
```

It asks four questions. Type:

| Prompt | What to enter |
|---|---|
| AWS Access Key ID | the access key you just created |
| AWS Secret Access Key | the secret access key |
| Default region name | `us-east-1` (or the region from step 1) |
| Default output format | `json` |

Check the login:

```powershell
aws sts get-caller-identity
```

The answer includes `"Account"` and `"Arn"`. The account number should be the account you meant to use. If the command says the security token is invalid, run `aws configure` again and re-paste the keys. A trailing space will cause that error.

## 8. First deploy

1. In File Explorer, open the folder that contains `README.md` and the `deploy` folder. That is the project folder.
2. Right-click an empty area of that folder. On Windows 11, click **Show more options** if the short menu does not list it. Click **Git Bash Here**. If that item is missing, open **Git Bash** from the Start menu and move into the folder. A Windows path such as `C:\Users\you\okta-test-app` is written like this in Git Bash:

```bash
cd /c/Users/you/okta-test-app
```

3. Confirm you are in the right folder. This must print the deploy script:

```bash
ls deploy
```

4. Start Docker Desktop and wait until it says it is running.
5. Run:

```bash
./deploy/lightsail.sh
```

Leave this window open. The first run often sits for several minutes on lines that say `state: PENDING` or `state: READY`. That is the container service being created. Then it builds the image and uploads it.

A finished run prints a block like this:

```text
Values for Okta:
  Single sign-on URL (ACS):      https://okta-test-app.abc123.us-east-1.cs.amazonlightsail.com/saml/acs
  Audience URI (SP Entity ID):   https://okta-test-app.abc123.us-east-1.cs.amazonlightsail.com/saml/metadata
  SCIM connector base URL:       https://okta-test-app.abc123.us-east-1.cs.amazonlightsail.com/scim/v2
  SCIM unique identifier field:  userName
  SCIM auth (HTTP Header) token: (a long hex string)
```

Copy all five lines into Notepad. The last line of the script also says that SAML is not configured yet. That sentence is expected on this first run.

The same secrets are saved in `.deploy.env` in the project folder. To open that file from Git Bash:

```bash
notepad .deploy.env
```

The line `SCIM_TOKEN=` is the same token. Copy the characters after the equals sign only. The line `SESSION_SECRET=` is a second secret the website uses for its own cookies. You do not paste that one into Okta. Keep the file. Later deploys reuse it so the Okta token does not change.

## 9. Wait until the site answers

The script starts the deployment and returns while AWS is still switching over. That takes another few minutes.

In PowerShell, check the state. Use the service name from your deploy. The default is `okta-test-app`.

```powershell
aws lightsail get-container-services --service-name okta-test-app --query "containerServices[0].state" --output text
```

Run it again until it prints `RUNNING`. `DEPLOYING` means wait.

In the browser, open the public website address and add `/healthz`. Example:

```text
https://okta-test-app.abc123.us-east-1.cs.amazonlightsail.com/healthz
```

You want:

```text
{"ok":true,"saml":false}
```

`"ok":true` means the website process is up. `"saml":false` means you have not given it Okta's metadata yet. Continue to [Integrate with Okta](okta.md). Come back to the next section when that guide tells you to copy the Metadata URL.

## Give the website Okta's address

You are in this section because the Okta app exists and you copied its **Metadata URL**. It looks like:

```text
https://yourcompany.okta.com/app/abc123/sso/saml/metadata
```

1. Open **Git Bash Here** in the project folder again (right-click the folder background; on Windows 11 use **Show more options**).
2. Paste the command below. Replace the URL with yours. Keep the quotes. This is one line.

```bash
SAML_IDP_METADATA_URL="https://yourcompany.okta.com/app/abc123/sso/saml/metadata" ./deploy/lightsail.sh
```

3. Wait until it finishes, then wait until the state command prints `RUNNING` again.
4. Refresh `/healthz` in the browser.

You want:

```text
{"ok":true,"saml":true}
```

`"saml":true` means the website read Okta's settings at startup. Go back to the Okta guide and continue with assigning a person and turning on provisioning.

If it stays `"saml":false`, open the logs in the next section. The usual causes are a metadata URL that was copied incomplete, or the deploy still running.

This second deploy replaces the container. If you had already pushed users, that list is empty again. Push them from Okta after this deploy, which is why the Okta guide waits until now.

## Change a setting later

The script remembers settings in `.deploy.env`. To change one, open Git Bash in the project folder and put the new value in front of the script. You do not have to repeat the metadata URL if it is already in `.deploy.env`.

Only people on this list can open the Admin page. Use the email addresses they sign in with:

```bash
ADMIN_USERS="you@example.com,other@example.com" ./deploy/lightsail.sh
```

Refuse sign-in unless Okta has pushed that person and they are still active:

```bash
REQUIRE_SCIM_USER=true ./deploy/lightsail.sh
```

Make every visit to `/login` ask Okta to check the sign-in policy again, instead of reusing an Okta session that is already open:

```bash
SAML_FORCE_AUTHN=true ./deploy/lightsail.sh
```

You can set several at once. Each one is still a single line:

```bash
REQUIRE_SCIM_USER=true SAML_FORCE_AUTHN=true ADMIN_USERS="you@example.com" ./deploy/lightsail.sh
```

Wait for `RUNNING`, then test. What each setting means is in [Configuration](configuration.md).

## Read the website log

In PowerShell, look at the last hour. The container inside the service is named `app`.

```powershell
$end = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$start = $end - 3600
aws lightsail get-container-log --service-name okta-test-app --container-name app --start-time $start --end-time $end --query "logEvents[].message" --output text
```

A good start looks like this:

```text
[saml] ready. IdP SSO URL: https://yourcompany.okta.com/app/.../sso/saml
[app] listening on :8080  base URL https://okta-test-app....cs.amazonlightsail.com
[app] ACS URL:   https://okta-test-app....cs.amazonlightsail.com/saml/acs
[app] Entity ID: https://okta-test-app....cs.amazonlightsail.com/saml/metadata
[app] SCIM base: https://okta-test-app....cs.amazonlightsail.com/scim/v2
```

You can also open the Lightsail console, click **Containers**, click `okta-test-app`, and use **Open log** on the current deployment.

## Deploy again, and how to delete the site

Every run of `./deploy/lightsail.sh` publishes a new copy and clears the user list and the sign-in log. Afterward, in Okta, open the app, go to **Provisioning**, then **To App**, and click **Save**, or remove and re-add the test user so Okta creates the user again.

Leave the service at one container. A second copy would not share the user file.

To remove the website from AWS, in PowerShell:

```powershell
aws lightsail delete-container-service --service-name okta-test-app
```

Confirm the name when it asks. Deleting the service does not delete `.deploy.env` on your PC. That file still contains the token.

## If a command fails immediately

| What you see | What to do |
|---|---|
| `docker: error` or "cannot connect to the Docker daemon" | Open Docker Desktop and wait until it is running. Run the script again. |
| `aws: command not found` inside Git Bash | Close Git Bash, open a new Git Bash window so it picks up PATH, and try `aws --version` before the script. |
| `node: command not found` | Install Node.js from step 4, open a new Git Bash, try `node --version`. |
| `lightsailctl: command not found` | Repeat step 6. `C:\lightsailctl` must be on PATH, and the window must be new. |
| `AccessDenied` | The IAM user from `aws sts get-caller-identity` is missing a Lightsail permission. The error names it. |
| The script says it could not determine the pushed image name | Read the lines above that message. The upload failed. Docker must be running, and `lightsailctl` must be on PATH. |
| State stays `DEPLOYING` for more than about 15 minutes | Open the log section above. A crash during startup is the usual reason the health check never passes. |

More cases are in [Troubleshooting](troubleshooting.md).

## If your team already uses ECS

Lightsail is the path this folder automates. Use this section only when the website must live on a hostname your company already controls, on ECS Fargate.

These are the pieces, in the order you create them:

| AWS name | What it is, in this setup |
|---|---|
| ECR | Storage for the container image you build on your PC. |
| Secrets Manager | Storage for the two passwords: the SCIM token and the session secret. |
| ACM certificate | The public certificate that lets the load balancer speak HTTPS for your DNS name. |
| Application Load Balancer | The public front door. Users connect to it on port 443. It forwards to the website on port 8080. |
| ECS service | Runs exactly one copy of the website. |

Still use one copy. The user list is a file inside that copy.

### Build the image and put it in ECR

Pick a region and stay in it for every item below. These examples use `us-east-1`. Replace `ACCOUNT` with the account number from `aws sts get-caller-identity`.

PowerShell:

```powershell
aws ecr create-repository --repository-name okta-test-app --region us-east-1
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.us-east-1.amazonaws.com
docker build --platform linux/amd64 -t okta-test-app:latest .
docker tag okta-test-app:latest ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/okta-test-app:latest
docker push ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/okta-test-app:latest
```

Run those from the project folder, in PowerShell, with Docker Desktop running.

### Create the two secrets

In the AWS console search bar, open **Secrets Manager**.

1. Click **Store a new secret**. Choose **Other type of secret**.
2. Choose **Plaintext** and paste a new random string. On the PC you can create one in PowerShell with:

```powershell
-join ((1..32 | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) }))
```

3. Name the first secret `okta-test-app/scim-token`. This is the value you will paste into Okta.
4. Repeat for `okta-test-app/session-secret`, with a different random string. That one stays inside AWS.

### Certificate, load balancer, and DNS

1. Open **Certificate Manager** in the same region. Request a public certificate for the name you will use, such as `okta-test.example.com`. ACM shows a DNS record. Create that record at the company that hosts the domain, and wait until the certificate says **Issued**.
2. Open **EC2**, then **Load Balancers**, and create an **Application Load Balancer** in two public subnets.
3. Create a target group: target type **IP**, protocol **HTTP**, port **8080**, health check path `/healthz`, success code `200`.
4. On the load balancer, add a listener on **HTTPS 443** that uses the certificate and forwards to that target group.
5. Add a listener on **HTTP 80** that redirects to HTTPS.
6. In DNS, point `okta-test.example.com` at the load balancer.

The website setting `BASE_URL` must be `https://okta-test.example.com` with no slash on the end. That exact text is what Okta will use for the sign-in URL and the audience.

### Run one task

Open **ECS** and create a cluster (the default Fargate cluster is enough).

Create a task definition:

| Field | Value |
|---|---|
| Launch type | Fargate |
| CPU / memory | 0.25 vCPU and 0.5 GB |
| Container name | `app` |
| Image | the ECR address you pushed |
| Port | 8080 |
| Environment variable `BASE_URL` | `https://okta-test.example.com` |
| Environment variable `SAML_IDP_METADATA_URL` | leave blank on the first run, then set Okta's metadata URL |
| Secrets | `SCIM_TOKEN` from `okta-test-app/scim-token`, and `SESSION_SECRET` from `okta-test-app/session-secret` |

The task execution role needs permission to pull the image, write logs, and read those two secrets. The AWS-managed policy `AmazonECSTaskExecutionRolePolicy` covers the image and the logs. Add `secretsmanager:GetSecretValue` on the two secrets.

Create a service from that task definition with **desired count 1**. Put the task in private subnets that have a path to the internet (a NAT gateway), so it can pull the image and, later, download Okta's metadata. Its security group should allow port 8080 only from the load balancer. The load balancer's security group should allow port 443 from the people who will test.

Wait until the target group is healthy. Open `https://okta-test.example.com/healthz`.

Then follow [Integrate with Okta](okta.md). When you have the metadata URL, edit the task definition, set `SAML_IDP_METADATA_URL`, and update the service so ECS starts a new task. Refresh `/healthz` until it says `"saml":true`.

Keep the desired count at 1 after every deploy. During the deploy, ECS may run the old and new copies together for a minute. Sign-in cookies from the old copy will not work on the new one, and the user list starts empty.

If the company runs Kubernetes instead, hand them the same rules: one replica, HTTPS in front, `BASE_URL` set to that public `https://` address, the two secrets injected as environment variables, and a health check on `/healthz` port 8080. The pod must be allowed to open HTTPS connections to your Okta org.
