const crypto = require("node:crypto");

function bool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function list(name) {
  return (process.env[name] || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const port = parseInt(process.env.PORT || "8080", 10);
const baseUrl = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, "");

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString("hex");
  console.warn("[config] SESSION_SECRET not set; using a random value (sessions reset on restart)");
}

module.exports = {
  port,
  baseUrl,
  appName: process.env.APP_NAME || "Okta Test App",
  sessionSecret,
  dataDir: process.env.DATA_DIR || "./data",

  saml: {
    // SP entity ID / audience. Must match "Audience URI (SP Entity ID)" in Okta.
    entityId: process.env.SAML_SP_ENTITY_ID || `${baseUrl}/saml/metadata`,
    acsUrl: `${baseUrl}/saml/acs`,
    // Either point at the Okta app's metadata URL...
    idpMetadataUrl: process.env.SAML_IDP_METADATA_URL || "",
    // ...or provide the SSO URL and signing cert directly.
    idpSsoUrl: process.env.SAML_IDP_SSO_URL || "",
    idpCert: process.env.SAML_IDP_CERT || "",
    idpIssuer: process.env.SAML_IDP_ISSUER || "",
    wantAssertionsSigned: bool("SAML_WANT_ASSERTIONS_SIGNED", true),
    wantResponseSigned: bool("SAML_WANT_RESPONSE_SIGNED", false),
    // Optional: request a specific AuthnContextClassRef (comma-separated). Empty = don't send one.
    authnContext: (process.env.SAML_AUTHN_CONTEXT || "").split(",").map((s) => s.trim()).filter(Boolean),
    forceAuthn: bool("SAML_FORCE_AUTHN", false),
  },

  scim: {
    token: process.env.SCIM_TOKEN || "",
  },

  // Deny SAML logins for users that weren't provisioned (and active) via SCIM.
  requireScimUser: bool("REQUIRE_SCIM_USER", false),
  // Emails/usernames allowed into /admin. Empty = any authenticated user.
  adminUsers: list("ADMIN_USERS"),
};
