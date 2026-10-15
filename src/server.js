const express = require("express");
const session = require("express-session");
const config = require("./config");
const store = require("./store");
const saml = require("./saml");
const scim = require("./scim");
const views = require("./views");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true); // behind an AWS load balancer / Lightsail proxy

app.get("/healthz", (req, res) => res.json({ ok: true, saml: !saml.error }));

// SCIM is token-authenticated and stateless; mount it before sessions.
app.use("/scim/v2", scim);

app.use(
  session({
    name: "okta_test_sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.baseUrl.startsWith("https://"),
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);

const html = (res, status, body) => res.status(status).type("html").send(body);

app.get("/", (req, res) => html(res, 200, views.home({ user: req.session.user, samlError: saml.error })));

app.get("/saml/metadata", (req, res) => res.type("application/xml").send(saml.spMetadata()));

// SP-initiated login. RelayState marks the flow so we can tell it apart from dashboard (IdP-initiated) logins.
app.get("/login", async (req, res, next) => {
  if (!saml.client) return html(res, 503, views.message("SAML not configured", saml.error));
  try {
    const target = typeof req.query.next === "string" && req.query.next.startsWith("/") ? req.query.next : "/";
    res.redirect(await saml.client.getAuthorizeUrlAsync(`sp:${target}`, req.get("host"), {}));
  } catch (err) {
    next(err);
  }
});

app.post("/saml/acs", express.urlencoded({ extended: false, limit: "2mb" }), async (req, res) => {
  if (!saml.client) return html(res, 503, views.message("SAML not configured", saml.error));
  const relay = req.body.RelayState || "";
  const idpInitiated = !relay.startsWith("sp:");

  let profile;
  try {
    ({ profile } = await saml.client.validatePostResponseAsync(req.body));
    if (!profile) throw new Error("No profile in SAML response");
  } catch (err) {
    console.warn("[saml] rejected response:", err.message);
    store.recordLogin({ ok: false, idpInitiated, error: err.message });
    return html(res, 401, views.message("SAML validation failed", err.message));
  }

  const attributes = saml.attributesOf(profile);
  const details = saml.describeAssertion(profile);
  const scimUser = store.findUserByUserName(profile.nameID) || store.findUserByUserName(profile.email);
  const entry = { nameID: profile.nameID, idpInitiated, authnContextClassRef: details.authnContextClassRef };

  if (config.requireScimUser && !(scimUser && scimUser.active)) {
    const reason = scimUser ? "User is deactivated in SCIM" : "User has not been provisioned via SCIM";
    store.recordLogin({ ...entry, ok: false, error: reason });
    return html(res, 403, views.message("Access denied", `${reason}. Assign the user to this app in Okta.`));
  }

  store.recordLogin({ ...entry, ok: true });

  req.session.regenerate((err) => {
    if (err) return html(res, 500, views.message("Session error", err.message));
    req.session.user = {
      nameID: profile.nameID,
      nameIDFormat: profile.nameIDFormat,
      issuer: profile.issuer,
      sessionIndex: details.sessionIndex,
      authnContextClassRef: details.authnContextClassRef,
      authnInstant: details.authnInstant,
      attributes,
      assertionXml: profile.getAssertionXml ? profile.getAssertionXml() : null,
      idpInitiated,
      loggedInAt: new Date().toISOString(),
      scimUser: scimUser ? { id: scimUser.id, active: scimUser.active } : null,
    };
    const target = idpInitiated ? "/" : relay.slice(3) || "/";
    res.redirect(target.startsWith("/") && !target.startsWith("//") ? target : "/");
  });
});

app.get("/logout", (req, res) => {
  // Local logout only. Okta session stays alive; use SAML_FORCE_AUTHN=true to force re-auth on every login.
  req.session.destroy(() => res.redirect("/"));
});

function requireAdmin(req, res, next) {
  const user = req.session.user;
  if (!user) return res.redirect("/login?next=/admin");
  if (config.adminUsers.length) {
    const ids = [user.nameID, user.attributes?.email].filter(Boolean).map((s) => String(s).toLowerCase());
    if (!ids.some((id) => config.adminUsers.includes(id))) {
      return html(res, 403, views.message("Forbidden", "You are not listed in ADMIN_USERS.", user));
    }
  }
  next();
}

app.get("/admin", requireAdmin, (req, res) =>
  html(res, 200, views.admin({ user: req.session.user, db: store.db, samlError: saml.error, idp: saml.idp })),
);

app.use((err, req, res, _next) => {
  console.error(err);
  html(res, 500, views.message("Error", err.message));
});

saml.init().then(() => {
  app.listen(config.port, () => {
    console.log(`[app] listening on :${config.port}  base URL ${config.baseUrl}`);
    console.log(`[app] ACS URL:   ${config.saml.acsUrl}`);
    console.log(`[app] Entity ID: ${config.saml.entityId}`);
    console.log(`[app] SCIM base: ${config.baseUrl}/scim/v2 ${config.scim.token ? "" : "(disabled: SCIM_TOKEN not set)"}`);
  });
});

module.exports = app;
