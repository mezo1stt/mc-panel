import express from "express";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import fs from "fs";

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

// ========== نظام الحظر الجديد ==========
const bannedData = {
    hwids: new Map(),        // HWID -> {reason, bannedBy, bannedAt}
    ips: new Map(),           // IP -> {reason, bannedBy, bannedAt}
    uuids: new Map(),         // UUID -> {reason, bannedBy, bannedAt}
    usernames: new Map(),     // Username -> {reason, bannedBy, bannedAt}
    serverUuids: new Map()    // Server UUID -> {reason, bannedBy, bannedAt}
};

// تحميل/حفظ البيانات
const BAN_FILE = path.join(__dirname, "bans.json");

function loadBans() {
    try {
        if (fs.existsSync(BAN_FILE)) {
            const data = JSON.parse(fs.readFileSync(BAN_FILE, 'utf8'));
            
            // تحويل المصفوفات إلى Maps
            bannedData.hwids = new Map(data.hwids || []);
            bannedData.ips = new Map(data.ips || []);
            bannedData.uuids = new Map(data.uuids || []);
            bannedData.usernames = new Map(data.usernames || []);
            bannedData.serverUuids = new Map(data.serverUuids || []);
            
            console.log(`✅ Loaded ${bannedData.hwids.size} HWID bans`);
        }
    } catch (e) {
        console.error("Failed to load bans:", e);
    }
}

function saveBans() {
    try {
        const data = {
            hwids: Array.from(bannedData.hwids.entries()),
            ips: Array.from(bannedData.ips.entries()),
            uuids: Array.from(bannedData.uuids.entries()),
            usernames: Array.from(bannedData.usernames.entries()),
            serverUuids: Array.from(bannedData.serverUuids.entries())
        };
        fs.writeFileSync(BAN_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Failed to save bans:", e);
    }
}

// تحميل البيانات عند البدء
loadBans();

// ========== دوال الحظر ==========

// حظر شامل (كل الطرق)
function banPlayer(playerInfo, reason, bannedBy = "system") {
    const banTime = new Date().toISOString();
    const banData = { reason, bannedBy, bannedAt: banTime };
    
    // حظر بكل الطرق الممكنة
    if (playerInfo.hwid) bannedData.hwids.set(playerInfo.hwid, banData);
    if (playerInfo.ip) bannedData.ips.set(playerInfo.ip, banData);
    if (playerInfo.uuid) bannedData.uuids.set(playerInfo.uuid, banData);
    if (playerInfo.username) bannedData.usernames.set(playerInfo.username.toLowerCase(), banData);
    if (playerInfo.serverUuid) bannedData.serverUuids.set(playerInfo.serverUuid, banData);
    
    saveBans();
    
    // إرسال أمر حظر للسيرفر فوراً
    if (playerInfo.serverUuid) {
        pendingCommands.set(playerInfo.serverUuid, {
            type: "ban_player",
            target: playerInfo,
            reason: reason,
            createdAt: banTime
        });
    }
    
    return true;
}

// فحص إذا كان شيء محظور
function isBanned(check) {
    if (check.hwid && bannedData.hwids.has(check.hwid)) {
        return { banned: true, type: "hwid", data: bannedData.hwids.get(check.hwid) };
    }
    if (check.ip && bannedData.ips.has(check.ip)) {
        return { banned: true, type: "ip", data: bannedData.ips.get(check.ip) };
    }
    if (check.uuid && bannedData.uuids.has(check.uuid)) {
        return { banned: true, type: "uuid", data: bannedData.uuids.get(check.uuid) };
    }
    if (check.username && bannedData.usernames.has(check.username.toLowerCase())) {
        return { banned: true, type: "username", data: bannedData.usernames.get(check.username.toLowerCase()) };
    }
    if (check.serverUuid && bannedData.serverUuids.has(check.serverUuid)) {
        return { banned: true, type: "server", data: bannedData.serverUuids.get(check.serverUuid) };
    }
    return { banned: false };
}

// رفع الحظر
function unbanPlayer(unbanInfo) {
    if (unbanInfo.hwid) bannedData.hwids.delete(unbanInfo.hwid);
    if (unbanInfo.ip) bannedData.ips.delete(unbanInfo.ip);
    if (unbanInfo.uuid) bannedData.uuids.delete(unbanInfo.uuid);
    if (unbanInfo.username) bannedData.usernames.delete(unbanInfo.username.toLowerCase());
    if (unbanInfo.serverUuid) bannedData.serverUuids.delete(unbanInfo.serverUuid);
    
    saveBans();
    return true;
}

// ========== الدوال المساعدة ==========

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

// ========== API Routes ==========

app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        service: "mc-panel",
        onlineServers: servers.size,
        bannedCount: {
            hwids: bannedData.hwids.size,
            ips: bannedData.ips.size,
            uuids: bannedData.uuids.size,
            usernames: bannedData.usernames.size,
            servers: bannedData.serverUuids.size
        },
        now: new Date().toISOString()
    });
});

// ========== Auth Routes ==========

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

// ========== Plugin Routes ==========

app.post("/plugin/register", (req, res) => {
    if (!requireToken(req, res)) return;

    const body = req.body || {};
    const serverUuid = String(body.serverUuid || "").trim();

    if (!serverUuid) {
        return res.status(400).json({ ok: false, error: "Missing serverUuid" });
    }

    // فحص إذا كان السيرفر محظور
    const banCheck = isBanned({ serverUuid });
    if (banCheck.banned) {
        return res.status(403).json({ 
            ok: false, 
            error: "Server is banned",
            banInfo: banCheck.data
        });
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

// ========== Ban Routes (للبلوقن) ==========

app.post("/plugin/check-ban", (req, res) => {
    if (!requireToken(req, res)) return;

    const { hwid, ip, uuid, username } = req.body || {};
    
    const banCheck = isBanned({ hwid, ip, uuid, username });
    
    return res.json({
        ok: true,
        banned: banCheck.banned,
        banInfo: banCheck.data
    });
});

app.post("/plugin/report-ban", (req, res) => {
    if (!requireToken(req, res)) return;

    const { playerInfo, reason, bannedBy } = req.body || {};
    
    banPlayer(playerInfo, reason, bannedBy || "plugin");
    
    return res.json({
        ok: true,
        message: "Player banned successfully"
    });
});

// ========== Panel API Routes (محمية) ==========

app.get("/api/servers", requirePanelAuth, (_req, res) => {
    const list = Array.from(servers.values()).sort((a, b) => {
        return new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime();
    });

    return res.json({
        ok: true,
        servers: list
    });
});

// ========== Ban Management Routes ==========

app.get("/api/bans", requirePanelAuth, (req, res) => {
    return res.json({
        ok: true,
        bans: {
            hwids: Array.from(bannedData.hwids.entries()).map(([hwid, data]) => ({ hwid, ...data })),
            ips: Array.from(bannedData.ips.entries()).map(([ip, data]) => ({ ip, ...data })),
            uuids: Array.from(bannedData.uuids.entries()).map(([uuid, data]) => ({ uuid, ...data })),
            usernames: Array.from(bannedData.usernames.entries()).map(([username, data]) => ({ username, ...data })),
            servers: Array.from(bannedData.serverUuids.entries()).map(([serverUuid, data]) => ({ serverUuid, ...data }))
        }
    });
});

app.post("/api/bans/player", requirePanelAuth, (req, res) => {
    const { playerInfo, reason } = req.body || {};
    
    if (!playerInfo) {
        return res.status(400).json({ ok: false, error: "Missing playerInfo" });
    }
    
    banPlayer(playerInfo, reason, req.panelUser.username);
    
    return res.json({
        ok: true,
        message: "Player banned successfully"
    });
});

app.post("/api/bans/unban", requirePanelAuth, (req, res) => {
    const { type, value } = req.body || {};
    
    const unbanInfo = {};
    unbanInfo[type] = value;
    
    unbanPlayer(unbanInfo);
    
    return res.json({
        ok: true,
        message: "Player unbanned successfully"
    });
});

// ========== Server Control Routes ==========

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

app.post("/api/servers/:uuid/ban-player", requirePanelAuth, (req, res) => {
    const uuid = String(req.params.uuid || "").trim();
    const { playerName, reason } = req.body || {};

    if (!servers.has(uuid)) {
        return res.status(404).json({ ok: false, error: "Server not found" });
    }

    if (!playerName) {
        return res.status(400).json({ ok: false, error: "Missing playerName" });
    }

    pendingCommands.set(uuid, {
        type: "ban_player_by_name",
        playerName: playerName,
        reason: reason || "Banned by panel",
        createdAt: new Date().toISOString()
    });

    return res.json({
        ok: true,
        queued: true,
        type: "ban_player",
        playerName,
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

// ========== Static Files ==========

app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// ========== Error Handling ==========

app.use((_req, res) => {
    res.status(404).json({ ok: false, error: "Not found" });
});

app.use((err, _req, res, _next) => {
    console.error("Server error:", err);
    res.status(500).json({ ok: false, error: "Internal server error" });
});

// ========== Start Server ==========

app.listen(PORT, "0.0.0.0", () => {
    console.log(`MC Panel running on port ${PORT}`);
    console.log(`Health: /health`);
    console.log(`Bans loaded: ${bannedData.hwids.size} HWIDs, ${bannedData.ips.size} IPs`);
});