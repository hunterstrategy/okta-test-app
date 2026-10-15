// Tiny JSON-file store. Good enough for a single-container test app.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const config = require("./config");

const file = path.join(config.dataDir, "db.json");
const MAX_LOGINS = 200;

let db = { users: {}, groups: {}, logins: [], scimLog: [] };

function load() {
  try {
    db = { ...db, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (err) {
    if (err.code !== "ENOENT") console.error("[store] failed to read db:", err.message);
  }
}

function save() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, file);
}

const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function findUserByUserName(userName) {
  if (!userName) return null;
  const needle = userName.toLowerCase();
  return Object.values(db.users).find((u) => (u.userName || "").toLowerCase() === needle) || null;
}

function recordLogin(entry) {
  db.logins.unshift({ at: now(), ...entry });
  db.logins.length = Math.min(db.logins.length, MAX_LOGINS);
  save();
}

function recordScim(entry) {
  db.scimLog.unshift({ at: now(), ...entry });
  db.scimLog.length = Math.min(db.scimLog.length, MAX_LOGINS);
  save();
}

load();

module.exports = {
  get db() {
    return db;
  },
  save,
  newId,
  now,
  findUserByUserName,
  recordLogin,
  recordScim,
};
