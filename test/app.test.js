// End-to-end test: boots the server against a fake IdP, posts a signed SAML response,
// and exercises the SCIM endpoints the way Okta does.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { SignedXml } = require("xml-crypto");

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const TOKEN = "test-token";
const key = fs.readFileSync(path.join(__dirname, "fixtures/idp-key.pem"), "utf8");
const cert = fs.readFileSync(path.join(__dirname, "fixtures/idp-cert.pem"), "utf8");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "okta-test-app-"));
let proc;

before(async () => {
  proc = spawn(process.execPath, ["src/server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(PORT),
      BASE_URL: BASE,
      DATA_DIR: dataDir,
      SCIM_TOKEN: TOKEN,
      SAML_IDP_SSO_URL: "https://idp.example.test/sso",
      SAML_IDP_CERT: cert,
      SAML_IDP_ISSUER: "http://www.okta.com/exkFAKE",
      REQUIRE_SCIM_USER: "true",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve) => proc.stdout.on("data", (d) => String(d).includes("listening") && resolve()));
});

after(() => {
  proc.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function samlResponse(nameID) {
  const now = new Date();
  const later = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  const id = `_${crypto.randomUUID()}`;
  const assertion = `<saml2:Assertion xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" IssueInstant="${now.toISOString()}" Version="2.0"><saml2:Issuer>http://www.okta.com/exkFAKE</saml2:Issuer><saml2:Subject><saml2:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${nameID}</saml2:NameID><saml2:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml2:SubjectConfirmationData NotOnOrAfter="${later}" Recipient="${BASE}/saml/acs"/></saml2:SubjectConfirmation></saml2:Subject><saml2:Conditions NotBefore="${now.toISOString()}" NotOnOrAfter="${later}"><saml2:AudienceRestriction><saml2:Audience>${BASE}/saml/metadata</saml2:Audience></saml2:AudienceRestriction></saml2:Conditions><saml2:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="${id}"><saml2:AuthnContext><saml2:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml2:AuthnContextClassRef></saml2:AuthnContext></saml2:AuthnStatement><saml2:AttributeStatement><saml2:Attribute Name="email"><saml2:AttributeValue>${nameID}</saml2:AttributeValue></saml2:Attribute><saml2:Attribute Name="amr"><saml2:AttributeValue>hwk</saml2:AttributeValue><saml2:AttributeValue>mfa</saml2:AttributeValue></saml2:Attribute></saml2:AttributeStatement></saml2:Assertion>`;

  const sig = new SignedXml({
    privateKey: key,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
  });
  sig.computeSignature(assertion, {
    location: { reference: "//*[local-name(.)='Issuer']", action: "after" },
  });

  const response = `<saml2p:Response xmlns:saml2p="urn:oasis:names:tc:SAML:2.0:protocol" Destination="${BASE}/saml/acs" ID="_r${crypto.randomUUID()}" IssueInstant="${now.toISOString()}" Version="2.0"><saml2:Issuer xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion">http://www.okta.com/exkFAKE</saml2:Issuer><saml2p:Status><saml2p:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></saml2p:Status>${sig.getSignedXml()}</saml2p:Response>`;
  return Buffer.from(response).toString("base64");
}

async function postAcs(nameID, relayState = "") {
  return fetch(`${BASE}/saml/acs`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ SAMLResponse: samlResponse(nameID), RelayState: relayState }),
  });
}

const scim = (method, p, body) =>
  fetch(`${BASE}/scim/v2${p}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/scim+json" },
    body: body && JSON.stringify(body),
  });

test("SP metadata is served", async () => {
  const res = await fetch(`${BASE}/saml/metadata`);
  const xml = await res.text();
  assert.equal(res.status, 200);
  assert.match(xml, new RegExp(`entityID="${BASE}/saml/metadata"`));
  assert.match(xml, new RegExp(`Location="${BASE}/saml/acs"`));
});

test("/login redirects to the IdP", async () => {
  const res = await fetch(`${BASE}/login`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location"), /^https:\/\/idp\.example\.test\/sso\?SAMLRequest=/);
});

test("SCIM rejects bad token", async () => {
  const res = await fetch(`${BASE}/scim/v2/Users`, { headers: { authorization: "Bearer nope" } });
  assert.equal(res.status, 401);
});

test("unprovisioned user is denied when REQUIRE_SCIM_USER=true", async () => {
  const res = await postAcs("alice@example.com");
  assert.equal(res.status, 403);
});

let userId;
test("SCIM user lifecycle (Okta style)", async () => {
  let res = await scim("GET", `/Users?filter=${encodeURIComponent('userName eq "alice@example.com"')}&startIndex=1&count=100`);
  assert.equal((await res.json()).totalResults, 0);

  res = await scim("POST", "/Users", {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: "alice@example.com",
    name: { givenName: "Alice", familyName: "Smith" },
    emails: [{ primary: true, value: "alice@example.com", type: "work" }],
    displayName: "Alice Smith",
    active: true,
  });
  assert.equal(res.status, 201);
  userId = (await res.json()).id;

  res = await scim("POST", "/Users", { userName: "ALICE@example.com" });
  assert.equal(res.status, 409);

  res = await scim("GET", `/Users?filter=${encodeURIComponent('userName eq "alice@example.com"')}`);
  assert.equal((await res.json()).Resources[0].id, userId);

  res = await scim("PUT", `/Users/${userId}`, { userName: "alice@example.com", name: { givenName: "Alicia", familyName: "Smith" }, active: true });
  assert.equal((await res.json()).name.givenName, "Alicia");

  res = await scim("PATCH", `/Users/${userId}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", path: "name.familyName", value: "Jones" }] });
  assert.equal((await res.json()).name.familyName, "Jones");
});

test("provisioned user can sign in; IdP-initiated and SP-initiated", async () => {
  let res = await postAcs("alice@example.com");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
  const cookie = res.headers.get("set-cookie").split(";")[0];

  const home = await (await fetch(`${BASE}/`, { headers: { cookie } })).text();
  assert.match(home, /Authenticated via SAML/);
  assert.match(home, /PasswordProtectedTransport/);
  assert.match(home, /IdP-initiated/);
  assert.match(home, /hwk/);
  assert.match(home, /Provisioned and active/);

  res = await postAcs("alice@example.com", "sp:/admin");
  assert.equal(res.headers.get("location"), "/admin");
  const admin = await (await fetch(`${BASE}/admin`, { headers: { cookie: res.headers.get("set-cookie").split(";")[0] } })).text();
  assert.match(admin, /SCIM users \(1\)/);
});

test("tampered SAML response is rejected", async () => {
  const good = Buffer.from(samlResponse("alice@example.com"), "base64").toString();
  const bad = Buffer.from(good.replace("alice@example.com</saml2:NameID>", "mallory@example.com</saml2:NameID>")).toString("base64");
  const res = await fetch(`${BASE}/saml/acs`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ SAMLResponse: bad }),
  });
  assert.equal(res.status, 401);
});

test("SCIM groups and deactivation", async () => {
  let res = await scim("POST", "/Groups", { schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"], displayName: "Testers", members: [] });
  assert.equal(res.status, 201);
  const groupId = (await res.json()).id;

  res = await scim("PATCH", `/Groups/${groupId}`, { Operations: [{ op: "add", path: "members", value: [{ value: userId, display: "alice@example.com" }] }] });
  assert.equal((await res.json()).members.length, 1);

  res = await scim("GET", `/Users/${userId}`);
  assert.equal((await res.json()).groups[0].display, "Testers");

  res = await scim("PATCH", `/Groups/${groupId}`, { Operations: [{ op: "remove", path: `members[value eq "${userId}"]` }] });
  assert.equal((await res.json()).members.length, 0);

  res = await scim("PATCH", `/Users/${userId}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", value: { active: false } }] });
  assert.equal((await res.json()).active, false);

  res = await postAcs("alice@example.com");
  assert.equal(res.status, 403);
});

test("parses Okta-style IdP metadata", () => {
  const { parseIdpMetadata } = require("../src/saml");
  const body = cert.replace(/-----(BEGIN|END) CERTIFICATE-----|\s+/g, "");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><md:EntityDescriptor entityID="http://www.okta.com/exk123" xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"><md:IDPSSODescriptor WantAuthnRequestsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><md:KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>${body}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor><md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat><md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://acme.okta.com/app/acme_test_1/exk123/sso/saml"/><md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://acme.okta.com/app/acme_test_1/exk123/sso/saml"/></md:IDPSSODescriptor></md:EntityDescriptor>`;
  const info = parseIdpMetadata(xml);
  assert.equal(info.issuer, "http://www.okta.com/exk123");
  assert.equal(info.ssoUrl, "https://acme.okta.com/app/acme_test_1/exk123/sso/saml");
  assert.deepEqual(info.certs, [body]);
});
