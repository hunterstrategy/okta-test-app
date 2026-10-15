const config = require("./config");

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmt = (v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : v);

function layout(title, body, user) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(config.appName)}</title>
<style>
  :root { --bg:#f6f7f9; --card:#fff; --text:#1c2230; --muted:#5f6b7a; --line:#e2e6ea; --accent:#1662dd; --ok:#127a3a; --bad:#b42318; }
  @media (prefers-color-scheme: dark) { :root { --bg:#12151b; --card:#1b1f27; --text:#e7eaf0; --muted:#9aa4b2; --line:#2b313c; --accent:#6ea2ff; --ok:#4cc27a; --bad:#ff7b72; } }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; background:var(--bg); color:var(--text); }
  header { display:flex; gap:16px; align-items:center; padding:12px 20px; border-bottom:1px solid var(--line); background:var(--card); flex-wrap:wrap; }
  header strong { margin-right:auto; }
  header a { color:var(--accent); text-decoration:none; }
  main { max-width:1000px; margin:24px auto; padding:0 16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:20px; margin-bottom:20px; overflow-x:auto; }
  h1 { font-size:22px; margin:0 0 12px; } h2 { font-size:17px; margin:0 0 12px; }
  table { border-collapse:collapse; width:100%; font-size:14px; }
  th, td { text-align:left; padding:6px 10px; border-bottom:1px solid var(--line); vertical-align:top; word-break:break-word; }
  th { color:var(--muted); font-weight:600; white-space:nowrap; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:13px; }
  pre { background:var(--bg); border:1px solid var(--line); padding:12px; border-radius:6px; overflow:auto; max-height:420px; }
  .btn { display:inline-block; background:var(--accent); color:#fff; padding:10px 18px; border-radius:6px; text-decoration:none; font-weight:600; }
  .ok { color:var(--ok); font-weight:600; } .bad { color:var(--bad); font-weight:600; } .muted { color:var(--muted); }
  details summary { cursor:pointer; color:var(--accent); }
</style>
</head>
<body>
<header>
  <strong>${esc(config.appName)}</strong>
  <a href="/">Home</a>
  <a href="/admin">Admin</a>
  ${user ? `<span class="muted">${esc(user.nameID)}</span><a href="/logout">Log out</a>` : `<a href="/login">Log in</a>`}
</header>
<main>${body}</main>
</body>
</html>`;
}

function kvTable(obj) {
  const rows = Object.entries(obj || {});
  if (!rows.length) return `<p class="muted">None</p>`;
  return `<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td><code>${esc(fmt(v))}</code></td></tr>`).join("")}</table>`;
}

function home({ user, samlError }) {
  if (!user) {
    return layout(
      "Home",
      `<div class="card">
        <h1>Not signed in</h1>
        <p>This app is a bare SAML 2.0 service provider for testing Okta sign-on policies.</p>
        ${samlError ? `<p class="bad">SAML not ready: ${esc(samlError)}</p>` : `<p><a class="btn" href="/login">Sign in with Okta</a></p>`}
        <p class="muted">SP metadata: <a href="/saml/metadata">${esc(config.saml.entityId)}</a></p>
      </div>`,
    );
  }
  const scimStatus = user.scimUser
    ? user.scimUser.active
      ? `<span class="ok">Provisioned and active</span>`
      : `<span class="bad">Provisioned but deactivated</span>`
    : `<span class="muted">Not provisioned via SCIM</span>`;
  return layout(
    "Home",
    `<div class="card">
      <h1><span class="ok">✓</span> Authenticated via SAML</h1>
      <table>
        <tr><th>NameID</th><td><code>${esc(user.nameID)}</code></td></tr>
        <tr><th>NameID format</th><td><code>${esc(user.nameIDFormat)}</code></td></tr>
        <tr><th>Issuer</th><td><code>${esc(user.issuer)}</code></td></tr>
        <tr><th>AuthnContextClassRef</th><td><code>${esc(user.authnContextClassRef || "(none)")}</code></td></tr>
        <tr><th>AuthnInstant</th><td><code>${esc(user.authnInstant || "(none)")}</code></td></tr>
        <tr><th>SessionIndex</th><td><code>${esc(user.sessionIndex || "(none)")}</code></td></tr>
        <tr><th>Flow</th><td>${user.idpInitiated ? "IdP-initiated (Okta dashboard)" : "SP-initiated (/login)"}</td></tr>
        <tr><th>Signed in at</th><td>${esc(user.loggedInAt)}</td></tr>
        <tr><th>SCIM</th><td>${scimStatus}</td></tr>
      </table>
    </div>
    <div class="card"><h2>Attribute statements</h2>${kvTable(user.attributes)}</div>
    <div class="card">
      <h2>Raw assertion</h2>
      <details><summary>Show signed assertion XML</summary><pre>${esc(user.assertionXml || "")}</pre></details>
    </div>`,
    user,
  );
}

function admin({ user, db, samlError, idp }) {
  const users = Object.values(db.users);
  const groups = Object.values(db.groups);
  const userRows = users
    .map(
      (u) => `<tr>
        <td><code>${esc(u.userName)}</code></td>
        <td>${esc([u.name?.givenName, u.name?.familyName].filter(Boolean).join(" ") || u.displayName || "")}</td>
        <td>${u.active ? `<span class="ok">active</span>` : `<span class="bad">inactive</span>`}</td>
        <td>${esc(groups.filter((g) => g.members.some((m) => m.value === u.id)).map((g) => g.displayName).join(", "))}</td>
        <td class="muted">${esc(u.lastModified)}</td>
      </tr>`,
    )
    .join("");
  const groupRows = groups
    .map((g) => `<tr><td>${esc(g.displayName)}</td><td>${g.members.length}</td><td class="muted">${esc(g.lastModified)}</td></tr>`)
    .join("");
  const loginRows = db.logins
    .slice(0, 50)
    .map(
      (l) => `<tr>
        <td class="muted">${esc(l.at)}</td>
        <td><code>${esc(l.nameID || "")}</code></td>
        <td>${l.ok ? `<span class="ok">ok</span>` : `<span class="bad">fail</span>`}</td>
        <td><code>${esc(l.authnContextClassRef || "")}</code></td>
        <td>${esc(l.error || (l.idpInitiated ? "IdP-initiated" : "SP-initiated"))}</td>
      </tr>`,
    )
    .join("");
  const scimRows = db.scimLog
    .slice(0, 50)
    .map(
      (s) => `<tr>
        <td class="muted">${esc(s.at)}</td><td>${esc(s.method)}</td><td><code>${esc(s.path)}</code></td>
        <td class="${s.status < 400 ? "ok" : "bad"}">${esc(s.status)}</td>
        <td>${s.body ? `<details><summary>body</summary><pre>${esc(JSON.stringify(s.body, null, 2))}</pre></details>` : ""}</td>
      </tr>`,
    )
    .join("");

  return layout(
    "Admin",
    `<div class="card">
      <h1>Admin console</h1>
      <table>
        <tr><th>SAML ACS URL</th><td><code>${esc(config.saml.acsUrl)}</code></td></tr>
        <tr><th>SP Entity ID / Audience</th><td><code>${esc(config.saml.entityId)}</code></td></tr>
        <tr><th>IdP SSO URL</th><td>${samlError ? `<span class="bad">${esc(samlError)}</span>` : `<code>${esc(idp?.ssoUrl)}</code>`}</td></tr>
        <tr><th>SCIM base URL</th><td><code>${esc(config.baseUrl)}/scim/v2</code> ${config.scim.token ? `<span class="ok">token set</span>` : `<span class="bad">SCIM_TOKEN not set</span>`}</td></tr>
        <tr><th>Require SCIM user</th><td>${config.requireScimUser ? "yes, unprovisioned users are denied" : "no, any valid SAML login is accepted"}</td></tr>
      </table>
    </div>
    <div class="card"><h2>Recent sign-ins</h2>
      ${loginRows ? `<table><tr><th>Time</th><th>NameID</th><th>Result</th><th>AuthnContextClassRef</th><th>Detail</th></tr>${loginRows}</table>` : `<p class="muted">No sign-ins yet.</p>`}
    </div>
    <div class="card"><h2>SCIM users (${users.length})</h2>
      ${userRows ? `<table><tr><th>userName</th><th>Name</th><th>Status</th><th>Groups</th><th>Updated</th></tr>${userRows}</table>` : `<p class="muted">No users provisioned yet. Assign someone to the app in Okta.</p>`}
    </div>
    <div class="card"><h2>SCIM groups (${groups.length})</h2>
      ${groupRows ? `<table><tr><th>Name</th><th>Members</th><th>Updated</th></tr>${groupRows}</table>` : `<p class="muted">No groups pushed yet.</p>`}
    </div>
    <div class="card"><h2>SCIM request log</h2>
      ${scimRows ? `<table><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th></th></tr>${scimRows}</table>` : `<p class="muted">No SCIM requests yet.</p>`}
    </div>`,
    user,
  );
}

function message(title, text, user) {
  return layout(title, `<div class="card"><h1>${esc(title)}</h1><p>${esc(text)}</p><p><a href="/">Home</a></p></div>`, user);
}

module.exports = { home, admin, message };
