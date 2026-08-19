import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const OPTIONAL_FIELDS = [
  "displayName", "email", "globalPriority", "defaultModel",
  "accessToken", "refreshToken", "expiresAt", "tokenType",
  "scope", "projectId", "apiKey", "testStatus",
  "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn", "errorCode",
  "consecutiveUseCount", "idToken", "lastRefreshAt",
];

function rowToConn(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    provider: row.provider,
    authType: row.authType,
    name: row.name,
    email: row.email,
    priority: row.priority,
    isActive: row.isActive === 1 || row.isActive === true,
    tenantId: row.tenantId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function connToRow(c) {
  const { id, provider, authType, name, email, priority, isActive, tenantId, createdAt, updatedAt, ...rest } = c;
  return {
    id,
    provider,
    authType,
    name: name ?? null,
    email: email ?? null,
    priority: priority ?? null,
    isActive: isActive === false ? 0 : 1,
    tenantId: tenantId ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

function upsert(db, c) {
  const r = connToRow(c);
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, tenantId, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider=excluded.provider, authType=excluded.authType, name=excluded.name,
       email=excluded.email, priority=excluded.priority, isActive=excluded.isActive,
       tenantId=excluded.tenantId, data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.provider, r.authType, r.name, r.email, r.priority, r.isActive, r.tenantId, r.data, r.createdAt, r.updatedAt]
  );
}

function deriveConnectionName(data, fallbackName) {
  if (data.provider === "github") {
    return data.providerSpecificData?.githubLogin
      || data.providerSpecificData?.githubEmail
      || data.email
      || data.providerSpecificData?.githubName
      || fallbackName;
  }
  return fallbackName;
}

// filter.tenantId (optional): when passed, only returns connections owned by
// that tenant OR legacy/global connections (tenantId IS NULL) — legacy data
// stays usable by every tenant until it's explicitly migrated (onda 2).
// Omitting filter.tenantId entirely keeps today's unfiltered behavior
// (retrocompat for callers not yet passing a tenant).
export async function getProviderConnections(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.provider) { where.push("provider = ?"); params.push(filter.provider); }
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.tenantId !== undefined) { where.push("(tenantId = ? OR tenantId IS NULL)"); params.push(filter.tenantId); }
  const sql = `SELECT * FROM providerConnections${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const rows = db.all(sql, params);
  const list = rows.map(rowToConn);
  list.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  return list;
}

export async function getProviderConnectionById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
  return rowToConn(row);
}

// Internal sync reorder — must be called INSIDE a transaction
function reorderInTx(db, providerId) {
  const list = db.all(`SELECT * FROM providerConnections WHERE provider = ?`, [providerId]).map(rowToConn);
  list.sort((a, b) => {
    const pDiff = (a.priority || 0) - (b.priority || 0);
    if (pDiff !== 0) return pDiff;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
  list.forEach((c, i) => {
    db.run(`UPDATE providerConnections SET priority = ? WHERE id = ?`, [i + 1, c.id]);
  });
}

export async function createProviderConnection(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  let result;

  db.transaction(() => {
    const all = db.all(`SELECT * FROM providerConnections WHERE provider = ?`, [data.provider]).map(rowToConn);

    // Dedup must never cross tenant boundaries — two different tenants can
    // legitimately register a connection with the same name/email/workspace
    // (e.g. both name a key "Gemini"), and without this guard the second
    // POST silently overwrites the first tenant's row via the upsert below
    // instead of creating an isolated one (found 2026-08-19, live migration).
    const incomingTenantId = data.tenantId || null;
    const sameTenant = c => (c.tenantId || null) === incomingTenantId;

    let existing = null;
    if (data.authType === "oauth" && data.email) {
      const incomingUsername = data.providerSpecificData?.username;
      const incomingWs = data.providerSpecificData?.chatgptAccountId;
      existing = all.find(c => {
        if (!sameTenant(c)) return false;
        if (c.authType !== "oauth" || c.email !== data.email) return false;

        // Codex/OpenAI can issue multiple OAuth grants for the same email.
        // Refresh tokens are rotated single-use; collapsing a new login onto an
        // existing bare-email row overwrites the first account's token pair and
        // makes it look "invalid" after adding a second account. Only update an
        // existing Codex row when both rows expose the same ChatGPT account ID.
        if (data.provider === "codex") {
          const existingWs = c.providerSpecificData?.chatgptAccountId;
          return !!incomingWs && !!existingWs && incomingWs === existingWs;
        }

        // Workspace providers use workspace ID when both sides have it
        const existingWs = c.providerSpecificData?.chatgptAccountId;
        if (incomingWs && existingWs) return incomingWs === existingWs;
        if (incomingWs && !existingWs) return false;
        if (!incomingWs && existingWs) return false;
        // Non-workspace providers: match on (email + username) so cross-IdP
        // accounts don't overwrite each other. Require username on both sides
        // — if only one side has it, treat as a distinct identity rather than
        // collapsing onto the bare-email fallback (which would re-introduce
        // the cross-IdP overwrite).
        const existingUsername = c.providerSpecificData?.username;
        if (incomingUsername && existingUsername) {
          return incomingUsername === existingUsername;
        }
        if (incomingUsername || existingUsername) return false;
        return true;
      });
    } else if (data.authType === "apikey" && data.name) {
      existing = all.find(c => sameTenant(c) && c.authType === "apikey" && c.name === data.name);
    }
    // access_token: never dedup — user manages duplicates manually

    if (existing) {
      const merged = { ...existing, ...data, updatedAt: now };
      upsert(db, merged);
      result = merged;
      return;
    }

    let connectionName = data.name || null;
    if (!connectionName && (data.authType === "oauth" || data.authType === "access_token")) {
      connectionName = deriveConnectionName(data, data.email || `Account ${all.length + 1}`);
    }
    let connectionPriority = data.priority;
    if (!connectionPriority) {
      connectionPriority = all.reduce((m, c) => Math.max(m, c.priority || 0), 0) + 1;
    }

    const conn = {
      id: uuidv4(),
      provider: data.provider,
      authType: data.authType || "oauth",
      name: connectionName,
      priority: connectionPriority,
      isActive: data.isActive !== undefined ? data.isActive : true,
      tenantId: data.tenantId || null,
      createdAt: now,
      updatedAt: now,
    };
    for (const f of OPTIONAL_FIELDS) {
      if (data[f] !== undefined && data[f] !== null) conn[f] = data[f];
    }
    if (data.providerSpecificData && Object.keys(data.providerSpecificData).length > 0) {
      conn.providerSpecificData = data.providerSpecificData;
    }
    if (data.email !== undefined) conn.email = data.email;

    upsert(db, conn);
    reorderInTx(db, data.provider);
    result = conn;
  });

  return result;
}

// Critical: OAuth refresh token race — atomic merge inside transaction
export async function updateProviderConnection(id, data) {
  const db = await getAdapter();
  let result;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
    if (!row) { result = null; return; }
    const existing = rowToConn(row);
    const merged = { ...existing, ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    if (data.priority !== undefined) reorderInTx(db, existing.provider);
    result = merged;
  });
  return result;
}

export async function deleteProviderConnection(id) {
  const db = await getAdapter();
  let ok = false;
  db.transaction(() => {
    const row = db.get(`SELECT provider FROM providerConnections WHERE id = ?`, [id]);
    if (!row) return;
    db.run(`DELETE FROM providerConnections WHERE id = ?`, [id]);
    reorderInTx(db, row.provider);
    ok = true;
  });
  return ok;
}

export async function deleteProviderConnectionsByProvider(providerId) {
  const db = await getAdapter();
  const before = db.get(`SELECT COUNT(*) AS n FROM providerConnections WHERE provider = ?`, [providerId]);
  db.run(`DELETE FROM providerConnections WHERE provider = ?`, [providerId]);
  return before?.n || 0;
}

export async function reorderProviderConnections(providerId) {
  const db = await getAdapter();
  db.transaction(() => reorderInTx(db, providerId));
}

export async function cleanupProviderConnections() {
  const db = await getAdapter();
  const fieldsToCheck = [
    "displayName", "email", "globalPriority", "defaultModel",
    "accessToken", "refreshToken", "expiresAt", "tokenType",
    "scope", "projectId", "apiKey", "testStatus",
    "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn",
    "consecutiveUseCount",
  ];
  let cleaned = 0;
  db.transaction(() => {
    const rows = db.all(`SELECT * FROM providerConnections`);
    for (const row of rows) {
      const conn = rowToConn(row);
      let dirty = false;
      for (const f of fieldsToCheck) {
        if (conn[f] === null || conn[f] === undefined) {
          if (f in conn) { delete conn[f]; cleaned++; dirty = true; }
        }
      }
      if (conn.providerSpecificData && Object.keys(conn.providerSpecificData).length === 0) {
        delete conn.providerSpecificData;
        cleaned++;
        dirty = true;
      }
      if (dirty) upsert(db, conn);
    }
  });
  return cleaned;
}
