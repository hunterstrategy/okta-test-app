// Minimal SCIM 2.0 server covering what Okta's SCIM connector uses:
// Users (list/filter, create, get, PUT, PATCH, DELETE) and Groups (same, plus member PATCH ops).
const crypto = require("node:crypto");
const express = require("express");
const config = require("./config");
const store = require("./store");

const SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const SCHEMA_GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";
const SCHEMA_LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const SCHEMA_ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";

const router = express.Router();
router.use(express.json({ type: ["application/json", "application/scim+json"], limit: "1mb" }));

function scimError(res, status, detail, scimType) {
  return res
    .status(status)
    .type("application/scim+json")
    .json({ schemas: [SCHEMA_ERROR], status: String(status), detail, ...(scimType && { scimType }) });
}

function send(res, status, body) {
  return res.status(status).type("application/scim+json").json(body);
}

// --- auth -------------------------------------------------------------------

router.use((req, res, next) => {
  if (!config.scim.token) return scimError(res, 503, "SCIM is disabled: SCIM_TOKEN is not set");
  const header = req.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  const a = Buffer.from(token);
  const b = Buffer.from(config.scim.token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    store.recordScim({ method: req.method, path: req.path, status: 401 });
    return scimError(res, 401, "Invalid or missing bearer token");
  }
  next();
});

// Log every authenticated request (handy when debugging Okta pushes from the admin page).
router.use((req, res, next) => {
  res.on("finish", () => {
    store.recordScim({
      method: req.method,
      path: req.originalUrl.replace(/^\/scim\/v2/, ""),
      status: res.statusCode,
      body: ["POST", "PUT", "PATCH"].includes(req.method) ? req.body : undefined,
    });
  });
  next();
});

// --- helpers ----------------------------------------------------------------

const base = () => `${config.baseUrl}/scim/v2`;

function userResource(u) {
  return {
    schemas: [SCHEMA_USER],
    id: u.id,
    externalId: u.externalId,
    userName: u.userName,
    name: u.name,
    displayName: u.displayName,
    emails: u.emails,
    active: u.active,
    groups: Object.values(store.db.groups)
      .filter((g) => g.members.some((m) => m.value === u.id))
      .map((g) => ({ value: g.id, display: g.displayName, $ref: `${base()}/Groups/${g.id}` })),
    ...(u.extra || {}),
    meta: { resourceType: "User", created: u.created, lastModified: u.lastModified, location: `${base()}/Users/${u.id}` },
  };
}

function groupResource(g) {
  return {
    schemas: [SCHEMA_GROUP],
    id: g.id,
    externalId: g.externalId,
    displayName: g.displayName,
    members: g.members,
    meta: { resourceType: "Group", created: g.created, lastModified: g.lastModified, location: `${base()}/Groups/${g.id}` },
  };
}

const USER_CORE = new Set(["schemas", "id", "meta", "externalId", "userName", "name", "displayName", "emails", "active", "groups", "password"]);

function applyUserFields(u, body) {
  if (body.userName !== undefined) u.userName = body.userName;
  if (body.externalId !== undefined) u.externalId = body.externalId;
  if (body.name !== undefined) u.name = body.name;
  if (body.displayName !== undefined) u.displayName = body.displayName;
  if (body.emails !== undefined) u.emails = body.emails;
  if (body.active !== undefined) u.active = body.active === true || body.active === "true" || body.active === "True";
  // Keep anything else Okta sends (enterprise extension, phone numbers, etc.) so it shows up on GET.
  const extra = Object.fromEntries(Object.entries(body).filter(([k]) => !USER_CORE.has(k)));
  if (Object.keys(extra).length) u.extra = { ...(u.extra || {}), ...extra };
  u.lastModified = store.now();
}

// Supports the `attr eq "value"` filters Okta sends (userName, externalId, displayName, id).
function parseFilter(filter) {
  if (!filter) return null;
  const m = filter.match(/^\s*([\w.]+)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i);
  if (!m) return { unsupported: true };
  return { attr: m[1], value: m[2].replace(/\\(.)/g, "$1").toLowerCase() };
}

function listResponse(req, res, items, toResource) {
  const startIndex = Math.max(1, parseInt(req.query.startIndex || "1", 10) || 1);
  const count = Math.max(0, parseInt(req.query.count || "100", 10) || 100);
  const page = items.slice(startIndex - 1, startIndex - 1 + count);
  send(res, 200, {
    schemas: [SCHEMA_LIST],
    totalResults: items.length,
    startIndex,
    itemsPerPage: page.length,
    Resources: page.map(toResource),
  });
}

function filtered(req, res, items) {
  const f = parseFilter(req.query.filter);
  if (!f) return items;
  if (f.unsupported) {
    scimError(res, 400, `Unsupported filter: ${req.query.filter}`, "invalidFilter");
    return null;
  }
  return items.filter((it) => String(it[f.attr] ?? "").toLowerCase() === f.value);
}

// --- discovery --------------------------------------------------------------

router.get("/ServiceProviderConfig", (req, res) =>
  send(res, 200, {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      { type: "oauthbearertoken", name: "Bearer Token", description: "Static bearer token (SCIM_TOKEN)", primary: true },
    ],
  }),
);

router.get("/ResourceTypes", (req, res) =>
  send(res, 200, {
    schemas: [SCHEMA_LIST],
    totalResults: 2,
    Resources: [
      { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "User", name: "User", endpoint: "/Users", schema: SCHEMA_USER },
      { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "Group", name: "Group", endpoint: "/Groups", schema: SCHEMA_GROUP },
    ],
  }),
);

// --- users ------------------------------------------------------------------

router.get("/Users", (req, res) => {
  const items = filtered(req, res, Object.values(store.db.users));
  if (items) listResponse(req, res, items, userResource);
});

router.post("/Users", (req, res) => {
  const body = req.body || {};
  if (!body.userName) return scimError(res, 400, "userName is required", "invalidValue");
  if (store.findUserByUserName(body.userName)) return scimError(res, 409, "User already exists", "uniqueness");
  const u = { id: store.newId(), created: store.now(), active: true };
  applyUserFields(u, body);
  store.db.users[u.id] = u;
  store.save();
  send(res, 201, userResource(u));
});

router.get("/Users/:id", (req, res) => {
  const u = store.db.users[req.params.id];
  if (!u) return scimError(res, 404, "User not found");
  send(res, 200, userResource(u));
});

router.put("/Users/:id", (req, res) => {
  const u = store.db.users[req.params.id];
  if (!u) return scimError(res, 404, "User not found");
  applyUserFields(u, req.body || {});
  store.save();
  send(res, 200, userResource(u));
});

router.patch("/Users/:id", (req, res) => {
  const u = store.db.users[req.params.id];
  if (!u) return scimError(res, 404, "User not found");
  for (const op of req.body?.Operations || []) {
    const kind = String(op.op || "").toLowerCase();
    if (kind !== "replace" && kind !== "add") continue; // Okta only sends replace/add for users
    if (op.path) {
      setPath(u, op.path, op.value);
    } else if (op.value && typeof op.value === "object") {
      for (const [k, v] of Object.entries(op.value)) setPath(u, k, v);
    }
  }
  u.lastModified = store.now();
  store.save();
  send(res, 200, userResource(u));
});

// Handles plain ("active") and dotted ("name.givenName") paths.
function setPath(u, path, value) {
  if (path.startsWith("urn:")) return applyUserFields(u, { [path]: value }); // extension attrs kept verbatim
  const [head, ...rest] = path.split(".");
  if (!rest.length) return applyUserFields(u, { [head]: value });
  const obj = { ...((USER_CORE.has(head) ? u[head] : u.extra?.[head]) || {}) };
  let cur = obj;
  for (let i = 0; i < rest.length - 1; i++) cur = cur[rest[i]] = { ...(cur[rest[i]] || {}) };
  cur[rest[rest.length - 1]] = value;
  applyUserFields(u, { [head]: obj });
}

router.delete("/Users/:id", (req, res) => {
  if (!store.db.users[req.params.id]) return scimError(res, 404, "User not found");
  delete store.db.users[req.params.id];
  for (const g of Object.values(store.db.groups)) g.members = g.members.filter((m) => m.value !== req.params.id);
  store.save();
  res.status(204).end();
});

// --- groups -----------------------------------------------------------------

router.get("/Groups", (req, res) => {
  const items = filtered(req, res, Object.values(store.db.groups));
  if (!items) return;
  const exclude = String(req.query.excludedAttributes || "").includes("members");
  listResponse(req, res, items, (g) => {
    const r = groupResource(g);
    if (exclude) delete r.members;
    return r;
  });
});

router.post("/Groups", (req, res) => {
  const body = req.body || {};
  if (!body.displayName) return scimError(res, 400, "displayName is required", "invalidValue");
  const g = {
    id: store.newId(),
    externalId: body.externalId,
    displayName: body.displayName,
    members: normalizeMembers(body.members),
    created: store.now(),
    lastModified: store.now(),
  };
  store.db.groups[g.id] = g;
  store.save();
  send(res, 201, groupResource(g));
});

router.get("/Groups/:id", (req, res) => {
  const g = store.db.groups[req.params.id];
  if (!g) return scimError(res, 404, "Group not found");
  send(res, 200, groupResource(g));
});

router.put("/Groups/:id", (req, res) => {
  const g = store.db.groups[req.params.id];
  if (!g) return scimError(res, 404, "Group not found");
  const body = req.body || {};
  if (body.displayName !== undefined) g.displayName = body.displayName;
  if (body.externalId !== undefined) g.externalId = body.externalId;
  if (body.members !== undefined) g.members = normalizeMembers(body.members);
  g.lastModified = store.now();
  store.save();
  send(res, 200, groupResource(g));
});

router.patch("/Groups/:id", (req, res) => {
  const g = store.db.groups[req.params.id];
  if (!g) return scimError(res, 404, "Group not found");
  for (const op of req.body?.Operations || []) {
    const kind = String(op.op || "").toLowerCase();
    const path = op.path || "";
    if (kind === "add" && path === "members") {
      for (const m of normalizeMembers(op.value)) {
        if (!g.members.some((x) => x.value === m.value)) g.members.push(m);
      }
    } else if (kind === "remove" && path.startsWith("members")) {
      const sel = path.match(/members\[value eq "([^"]+)"\]/);
      if (sel) g.members = g.members.filter((m) => m.value !== sel[1]);
      else if (Array.isArray(op.value)) {
        const ids = new Set(op.value.map((v) => v.value));
        g.members = g.members.filter((m) => !ids.has(m.value));
      } else g.members = [];
    } else if (kind === "replace" && path === "members") {
      g.members = normalizeMembers(op.value);
    } else if (kind === "replace") {
      const v = path ? { [path]: op.value } : op.value || {};
      if (v.displayName !== undefined) g.displayName = v.displayName;
      if (v.externalId !== undefined) g.externalId = v.externalId;
    }
  }
  g.lastModified = store.now();
  store.save();
  // Okta accepts 204 or 200 here; return the resource so it's easy to inspect.
  send(res, 200, groupResource(g));
});

router.delete("/Groups/:id", (req, res) => {
  if (!store.db.groups[req.params.id]) return scimError(res, 404, "Group not found");
  delete store.db.groups[req.params.id];
  store.save();
  res.status(204).end();
});

function normalizeMembers(members) {
  return (Array.isArray(members) ? members : [])
    .filter((m) => m && m.value)
    .map((m) => ({ value: m.value, display: m.display || store.db.users[m.value]?.userName }));
}

router.use((req, res) => scimError(res, 404, `No SCIM endpoint at ${req.method} ${req.path}`));

router.use((err, req, res, _next) => {
  if (err.type === "entity.parse.failed") return scimError(res, 400, "Request body is not valid JSON", "invalidSyntax");
  console.error("[scim]", err);
  scimError(res, 500, "Internal error");
});

module.exports = router;
