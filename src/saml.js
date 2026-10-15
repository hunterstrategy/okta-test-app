const { SAML } = require("@node-saml/node-saml");
const { DOMParser } = require("@xmldom/xmldom");
const config = require("./config");

const NS_MD = "urn:oasis:names:tc:SAML:2.0:metadata";
const NS_DS = "http://www.w3.org/2000/09/xmldsig#";
const NS_SAML = "urn:oasis:names:tc:SAML:2.0:assertion";

let saml = null;
let idpInfo = null;
let lastError = null;

function parseIdpMetadata(xml) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const entity = doc.getElementsByTagNameNS(NS_MD, "EntityDescriptor")[0];
  if (!entity) throw new Error("IdP metadata has no EntityDescriptor");
  const idp = entity.getElementsByTagNameNS(NS_MD, "IDPSSODescriptor")[0];
  if (!idp) throw new Error("IdP metadata has no IDPSSODescriptor");

  const ssoServices = Array.from(idp.getElementsByTagNameNS(NS_MD, "SingleSignOnService"));
  const sso =
    ssoServices.find((s) => s.getAttribute("Binding").endsWith("HTTP-Redirect")) || ssoServices[0];
  if (!sso) throw new Error("IdP metadata has no SingleSignOnService");

  const certs = Array.from(idp.getElementsByTagNameNS(NS_MD, "KeyDescriptor"))
    .filter((k) => !k.getAttribute("use") || k.getAttribute("use") === "signing")
    .flatMap((k) => Array.from(k.getElementsByTagNameNS(NS_DS, "X509Certificate")))
    .map((c) => c.textContent.replace(/\s+/g, ""));
  if (!certs.length) throw new Error("IdP metadata has no signing certificate");

  return {
    issuer: entity.getAttribute("entityID"),
    ssoUrl: sso.getAttribute("Location"),
    certs,
  };
}

async function loadIdpInfo() {
  const c = config.saml;
  if (c.idpMetadataUrl) {
    const res = await fetch(c.idpMetadataUrl);
    if (!res.ok) throw new Error(`Fetching IdP metadata failed: HTTP ${res.status}`);
    return parseIdpMetadata(await res.text());
  }
  if (c.idpSsoUrl && c.idpCert) {
    return {
      issuer: c.idpIssuer || undefined,
      ssoUrl: c.idpSsoUrl,
      certs: [c.idpCert.replace(/-----(BEGIN|END) CERTIFICATE-----|\s+/g, "")],
    };
  }
  throw new Error("SAML is not configured: set SAML_IDP_METADATA_URL (or SAML_IDP_SSO_URL + SAML_IDP_CERT)");
}

async function init() {
  try {
    idpInfo = await loadIdpInfo();
    const c = config.saml;
    saml = new SAML({
      callbackUrl: c.acsUrl,
      entryPoint: idpInfo.ssoUrl,
      issuer: c.entityId,
      audience: c.entityId,
      idpCert: idpInfo.certs,
      idpIssuer: c.idpIssuer || idpInfo.issuer,
      wantAssertionsSigned: c.wantAssertionsSigned,
      wantAuthnResponseSigned: c.wantResponseSigned,
      identifierFormat: null, // let Okta use the NameID format configured on the app
      disableRequestedAuthnContext: c.authnContext.length === 0,
      authnContext: c.authnContext.length ? c.authnContext : undefined,
      forceAuthn: c.forceAuthn,
      validateInResponseTo: "never", // allow IdP-initiated logins from the Okta dashboard
      acceptedClockSkewMs: 60_000,
    });
    lastError = null;
    console.log(`[saml] ready. IdP SSO URL: ${idpInfo.ssoUrl}`);
  } catch (err) {
    saml = null;
    lastError = err.message;
    console.error(`[saml] ${err.message}`);
  }
}

// Pull the bits that matter for MFA / phishing-resistance testing out of the signed assertion.
function describeAssertion(profile) {
  const out = { authnContextClassRef: null, authnInstant: null, sessionIndex: profile.sessionIndex || null };
  const xml = profile.getAssertionXml ? profile.getAssertionXml() : null;
  if (!xml) return out;
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const stmt = doc.getElementsByTagNameNS(NS_SAML, "AuthnStatement")[0];
  if (stmt) {
    out.authnInstant = stmt.getAttribute("AuthnInstant") || null;
    const ref = stmt.getElementsByTagNameNS(NS_SAML, "AuthnContextClassRef")[0];
    if (ref) out.authnContextClassRef = ref.textContent.trim();
  }
  return out;
}

// Attribute statements, minus node-saml's own bookkeeping fields.
const PROFILE_INTERNAL = new Set([
  "issuer", "sessionIndex", "nameID", "nameIDFormat", "nameQualifier", "spNameQualifier",
  "ID", "mail", "email", "attributes", "getAssertionXml", "getAssertion", "getSamlResponseXml",
]);

function attributesOf(profile) {
  if (profile.attributes && typeof profile.attributes === "object") return profile.attributes;
  return Object.fromEntries(Object.entries(profile).filter(([k]) => !PROFILE_INTERNAL.has(k)));
}

module.exports = {
  init,
  get client() {
    return saml;
  },
  get idp() {
    return idpInfo;
  },
  get error() {
    return lastError;
  },
  spMetadata() {
    // Metadata generation needs a SAML instance; build a throwaway one if the IdP isn't configured yet.
    const inst =
      saml ||
      new SAML({ callbackUrl: config.saml.acsUrl, issuer: config.saml.entityId, idpCert: "unused" });
    return inst.generateServiceProviderMetadata(null, null);
  },
  describeAssertion,
  attributesOf,
  parseIdpMetadata,
};
