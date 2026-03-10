import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.PANEL_TOKEN || "CHANGE_ME_LONG_RANDOM_TOKEN";

const servers = new Map();
const pendingCommands = new Map();
const blockedServers = new Map(); // uuid -> { serverUuid, serverName, blockedAt, reason }

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
    blockedServers: blockedServers.size,
    now: new Date().toISOString()
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
  const blocked = blockedServers.has(serverUuid);

  const record = {
    serverUuid,
    serverName: String(body.serverName ?? existing?.serverName ?? "Unknown"),
    pluginName: String(body.pluginName ?? existing?.pluginName ?? "Unknown"),
    pluginVersion: String(body.pluginVersion ?? existing?.pluginVersion ?? "Unknown"),
    players: Array.isArray(body.players) ? cleanPlayers(body.players) : (existing?.players ?? []),
    lastUpdate: new Date().toISOString(),
    blocked
  };

  servers.set(serverUuid, record);

  return res.json({
    ok: true,
    created: !existing,
    updated: !!existing,
    serverUuid,
    blocked
  });
});

app.get("/plugin/poll", (req, res) => {
  if (!requireToken(req, res)) return;

  const serverUuid = String(req.query.serverUuid || "").trim();
  if (!serverUuid) {
    return res.status(400).json({ ok: false, error: "Missing serverUuid" });
  }

  const blocked = blockedServers.has(serverUuid);
  const cmd = pendingCommands.get(serverUuid) || null;

  if (cmd) {
    pendingCommands.delete(serverUuid);
  }

  return res.json({
    ok: true,
    blocked,
    command: cmd
  });
});

app.get("/api/servers", (_req, res) => {
  const list = Array.from(servers.values()).sort((a, b) => {
    return new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime();
  });

  return res.json({
    ok: true,
    servers: list
  });
});

app.get("/api/blocked", (_req, res) => {
  const list = Array.from(blockedServers.values()).sort((a, b) => {
    return new Date(b.blockedAt).getTime() - new Date(a.blockedAt).getTime();
  });

  return res.json({
    ok: true,
    blocked: list
  });
});

app.post("/api/servers/:uuid/shutdown", (req, res) => {
  if (!requireToken(req, res)) return;

  const uuid = String(req.params.uuid || "").trim();
  const server = servers.get(uuid);

  if (!server) {
    return res.status(404).json({ ok: false, error: "Server not found" });
  }

  blockedServers.set(uuid, {
    serverUuid: uuid,
    serverName: server.serverName || "Unknown",
    blockedAt: new Date().toISOString(),
    reason: "Blocked from panel after shutdown"
  });

  if (servers.has(uuid)) {
    servers.set(uuid, {
      ...server,
      blocked: true,
      lastUpdate: new Date().toISOString()
    });
  }

  pendingCommands.set(uuid, {
    type: "shutdown",
    createdAt: new Date().toISOString()
  });

  return res.json({
    ok: true,
    queued: true,
    type: "shutdown",
    blocked: true,
    serverUuid: uuid
  });
});

app.post("/api/servers/:uuid/unblock", (req, res) => {
  if (!requireToken(req, res)) return;

  const uuid = String(req.params.uuid || "").trim();

  if (!blockedServers.has(uuid)) {
    return res.status(404).json({ ok: false, error: "Blocked server not found" });
  }

  blockedServers.delete(uuid);

  const server = servers.get(uuid);
  if (server) {
    servers.set(uuid, {
      ...server,
      blocked: false,
      lastUpdate: new Date().toISOString()
    });
  }

  return res.json({
    ok: true,
    unblocked: true,
    serverUuid: uuid
  });
});

app.post("/api/servers/:uuid/command", (req, res) => {
  if (!requireToken(req, res)) return;

  const uuid = String(req.params.uuid || "").trim();
  if (!servers.has(uuid)) {
    return res.status(404).json({ ok: false, error: "Server not found" });
  }

  if (blockedServers.has(uuid)) {
    return res.status(403).json({ ok: false, error: "Server is blocked" });
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

app.get("/blocked", (_req, res) => {
  res.sendFile(path.join(__dirname, "blocked.html"));
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