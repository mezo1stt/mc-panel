import express from "express";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.PANEL_TOKEN || "mezo_secret_123";

const PANEL_USERNAME = process.env.PANEL_USERNAME || "mezo";
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || "moaz12345";
const SESSION_COOKIE = "panel_session";

const servers = new Map();
const pendingCommands = new Map();
const panelSessions = new Map();

function parseCookies(cookieHeader = "") {
  const out = {};
  for (const part of String(cookieHeader).split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = decodeURIComponent(part.slice(0, idx).trim());
    const value = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = value;
  }
  return out;
}

function createSession(username) {
  const sessionId = crypto.randomBytes(32).toString("hex");
  panelSessions.set(sessionId, {
    username,
    createdAt: new Date().toISOString()
  });
  return sessionId;
}

function clearSession(sessionId) {
  if (sessionId) panelSessions.delete(sessionId);
}

function requirePanelAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || "");
  const sessionId = cookies[SESSION_COOKIE];

  if (!sessionId || !panelSessions.has(sessionId)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  req.panelUser = panelSessions.get(sessionId);
  next();
}

function requireToken(req, res) {
  const token = req.header("X-Token");
  if (token !== TOKEN) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

function cleanPlayers(players) {
  if (!Array.isArray(players)) return [];
  return players.map((p) => ({
    name: String(p?.name ?? "Unknown"),
    uuid: String(p?.uuid ?? "Unknown")
  }));
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "mc-panel",
    onlineServers: servers.size,
    now: new Date().toISOString()
  });
});

app.post("/auth/login", (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "").trim();

  if (username !== PANEL_USERNAME || password !== PANEL_PASSWORD) {
    return res.status(401).json({ ok: false, error: "Invalid username or password" });
  }

  const sessionId = createSession(username);

  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Strict; Path=/`
  );

  return res.json({ ok: true, username });
});

app.post("/auth/logout", (req, res) => {
  const cookies = parseCookies(req.headers.cookie || "");
  const sessionId = cookies[SESSION_COOKIE];

  clearSession(sessionId);

  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
  );

  return res.json({ ok: true });
});

app.get("/auth/me", (req, res) => {
  const cookies = parseCookies(req.headers.cookie || "");
  const sessionId = cookies[SESSION_COOKIE];

  if (!sessionId || !panelSessions.has(sessionId)) {
    return res.json({ ok: false, loggedIn: false });
  }

  const session = panelSessions.get(sessionId);
  return res.json({
    ok: true,
    loggedIn: true,
    username: session.username
  });
});

app.post("/plugin/register", (req, res) => {
  if (!requireToken(req, res)) return;

  const body = req.body || {};
  const serverUuid = String(body.serverUuid || "").trim();

  if (!serverUuid) {
    return res.status(400).json({ ok: false, error: "Missing serverUuid" });
  }

  const existing = servers.get(serverUuid);

  const record = {
    serverUuid,
    serverName: String(body.serverName ?? existing?.serverName ?? "Unknown"),
    pluginName: String(body.pluginName ?? existing?.pluginName ?? "Unknown"),
    pluginVersion: String(body.pluginVersion ?? existing?.pluginVersion ?? "Unknown"),
    players: Array.isArray(body.players) ? cleanPlayers(body.players) : (existing?.players ?? []),
    lastUpdate: new Date().toISOString()
  };

  servers.set(serverUuid, record);

  return res.json({
    ok: true,
    created: !existing,
    updated: !!existing,
    serverUuid
  });
});

app.get("/plugin/poll", (req, res) => {
  if (!requireToken(req, res)) return;

  const serverUuid = String(req.query.serverUuid || "").trim();
  if (!serverUuid) {
    return res.status(400).json({ ok: false, error: "Missing serverUuid" });
  }

  const cmd = pendingCommands.get(serverUuid) || null;

  if (cmd) {
    pendingCommands.delete(serverUuid);
  }

  return res.json({
    ok: true,
    command: cmd
  });
});

app.get("/api/servers", requirePanelAuth, (_req, res) => {
  const list = Array.from(servers.values()).sort((a, b) => {
    return new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime();
  });

  return res.json({
    ok: true,
    servers: list
  });
});

app.post("/api/servers/:uuid/shutdown", requirePanelAuth, (req, res) => {
  const uuid = String(req.params.uuid || "").trim();

  if (!servers.has(uuid)) {
    return res.status(404).json({ ok: false, error: "Server not found" });
  }

  pendingCommands.set(uuid, {
    type: "shutdown",
    createdAt: new Date().toISOString()
  });

  return res.json({
    ok: true,
    queued: true,
    type: "shutdown",
    serverUuid: uuid
  });
});

app.post("/api/servers/:uuid/update-github", requirePanelAuth, (req, res) => {
  const uuid = String(req.params.uuid || "").trim();

  if (!servers.has(uuid)) {
    return res.status(404).json({ ok: false, error: "Server not found" });
  }

  pendingCommands.set(uuid, {
    type: "update_from_github",
    createdAt: new Date().toISOString()
  });

  return res.json({
    ok: true,
    queued: true,
    type: "update_from_github",
    serverUuid: uuid
  });
});

app.post("/api/servers/:uuid/command", requirePanelAuth, (req, res) => {
  const uuid = String(req.params.uuid || "").trim();

  if (!servers.has(uuid)) {
    return res.status(404).json({ ok: false, error: "Server not found" });
  }

  let suffix = String(req.body?.suffix ?? "").trim();

  if (suffix.startsWith("/mezo")) {
    suffix = suffix.slice(5).trim();
  } else if (suffix.startsWith("mezo")) {
    suffix = suffix.slice(4).trim();
  } else if (suffix.startsWith("/")) {
    suffix = suffix.slice(1).trim();
  }

  if (suffix.length > 200) {
    return res.status(400).json({ ok: false, error: "Command too long" });
  }

  pendingCommands.set(uuid, {
    type: "command",
    suffix,
    createdAt: new Date().toISOString()
  });

  return res.json({
    ok: true,
    queued: true,
    type: "command",
    suffix,
    fullCommand: suffix ? `mezo ${suffix}` : "mezo",
    serverUuid: uuid
  });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

app.use((err, _req, res, _next) => {
  console.error("Server error:", err);
  res.status(500).json({ ok: false, error: "Internal server error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MC Panel running on port ${PORT}`);
  console.log(`Health: /health`);
});