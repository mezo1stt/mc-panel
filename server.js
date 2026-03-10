import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Render يعطي البورت من environment
const PORT = process.env.PORT || 3000;

// التوكن للحماية
const TOKEN = process.env.PANEL_TOKEN || "CHANGE_ME_TOKEN";

// السيرفرات المتصلة
const servers = new Map();

// أوامر معلقة
const pendingCommands = new Map();

function requireToken(req, res) {
  const token = req.header("X-Token");
  if (token !== TOKEN) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  return true;
}

// health check
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "mc-panel",
    servers: servers.size,
    time: new Date().toISOString()
  });
});

// تسجيل السيرفر من البلوقن
app.post("/plugin/register", (req, res) => {
  if (!requireToken(req, res)) return;

  const body = req.body || {};
  const serverUuid = body.serverUuid;

  if (!serverUuid) {
    return res.status(400).json({ ok: false, error: "Missing serverUuid" });
  }

  const record = {
    serverUuid,
    serverName: body.serverName || "Unknown",
    pluginName: body.pluginName || "Unknown",
    pluginVersion: body.pluginVersion || "Unknown",
    players: body.players || [],
    lastUpdate: new Date().toISOString()
  };

  servers.set(serverUuid, record);

  res.json({
    ok: true,
    created: true,
    serverUuid
  });
});

// البلوقن يسحب الأوامر
app.get("/plugin/poll", (req, res) => {
  if (!requireToken(req, res)) return;

  const serverUuid = req.query.serverUuid;

  if (!serverUuid) {
    return res.status(400).json({ ok: false, error: "Missing serverUuid" });
  }

  const cmd = pendingCommands.get(serverUuid) || null;

  if (cmd) {
    pendingCommands.delete(serverUuid);
  }

  res.json({
    ok: true,
    command: cmd
  });
});

// عرض السيرفرات في الموقع
app.get("/api/servers", (req, res) => {
  const list = Array.from(servers.values());
  res.json({
    ok: true,
    servers: list
  });
});

// زر shutdown
app.post("/api/servers/:uuid/shutdown", (req, res) => {
  const uuid = req.params.uuid;

  if (!servers.has(uuid)) {
    return res.status(404).json({ ok: false, error: "Server not found" });
  }

  pendingCommands.set(uuid, {
    type: "shutdown",
    createdAt: new Date().toISOString()
  });

  res.json({
    ok: true,
    queued: true
  });
});

// الصفحة الرئيسية
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("MC Panel running on port", PORT);
});
