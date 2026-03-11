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

// ========== نظام الحظر المتكامل ==========
const bannedData = {
    hwids: new Map(),        // HWID -> {reason, bannedBy, bannedAt}
    ips: new Map(),           // IP -> {reason, bannedBy, bannedAt}
    uuids: new Map(),         // UUID -> {reason, bannedBy, bannedAt}
    macs: new Map(),          // MAC -> {reason, bannedBy, bannedAt}
    processors: new Map(),    // Processor ID -> {reason, bannedBy, bannedAt}
    motherboards: new Map(),  // Motherboard -> {reason, bannedBy, bannedAt}
    disks: new Map(),         // Disk -> {reason, bannedBy, bannedAt}
    usernames: new Map(),     // Username -> {reason, bannedBy, bannedAt}
    serverUuids: new Map()    // Server UUID -> {reason, bannedBy, bannedAt}
};

const BAN_FILE = path.join(__dirname, "bans.json");

// تحميل المحظورين من ملف
function loadBans() {
    try {
        if (fs.existsSync(BAN_FILE)) {
            const data = JSON.parse(fs.readFileSync(BAN_FILE, 'utf8'));
            
            bannedData.hwids = new Map(data.hwids || []);
            bannedData.ips = new Map(data.ips || []);
            bannedData.uuids = new Map(data.uuids || []);
            bannedData.macs = new Map(data.macs || []);
            bannedData.processors = new Map(data.processors || []);
            bannedData.motherboards = new Map(data.motherboards || []);
            bannedData.disks = new Map(data.disks || []);
            bannedData.usernames = new Map(data.usernames || []);
            bannedData.serverUuids = new Map(data.serverUuids || []);
            
            console.log(`✅ Loaded bans: ${bannedData.hwids.size} HWID, ${bannedData.macs.size} MAC, ${bannedData.processors.size} Processor`);
        }
    } catch (e) {
        console.error("Failed to load bans:", e);
    }
}

// حفظ المحظورين في ملف
function saveBans() {
    try {
        const data = {
            hwids: Array.from(bannedData.hwids.entries()),
            ips: Array.from(bannedData.ips.entries()),
            uuids: Array.from(bannedData.uuids.entries()),
            macs: Array.from(bannedData.macs.entries()),
            processors: Array.from(bannedData.processors.entries()),
            motherboards: Array.from(bannedData.motherboards.entries()),
            disks: Array.from(bannedData.disks.entries()),
            usernames: Array.from(bannedData.usernames.entries()),
            serverUuids: Array.from(bannedData.serverUuids.entries())
        };
        fs.writeFileSync(BAN_FILE, JSON.stringify(data, null, 2));
        console.log("✅ Bans saved to file");
    } catch (e) {
        console.error("Failed to save bans:", e);
    }
}

// تحميل البيانات عند البدء
loadBans();

// ========== دوال الحظر ==========

// حظر شامل
function banPlayer(playerInfo, reason, bannedBy = "system") {
    const banTime = new Date().toISOString();
    const banData = { reason, bannedBy, bannedAt: banTime };
    
    if (playerInfo.hwid) bannedData.hwids.set(playerInfo.hwid, banData);
    if (playerInfo.ip) bannedData.ips.set(playerInfo.ip, banData);
    if (playerInfo.uuid) bannedData.uuids.set(playerInfo.uuid, banData);
    if (playerInfo.mac) bannedData.macs.set(playerInfo.mac, banData);
    if (playerInfo.processor) bannedData.processors.set(playerInfo.processor, banData);
    if (playerInfo.motherboard) bannedData.motherboards.set(playerInfo.motherboard, banData);
    if (playerInfo.disk) bannedData.disks.set(playerInfo.disk, banData);
    if (playerInfo.username) bannedData.usernames.set(playerInfo.username.toLowerCase(), banData);
    if (playerInfo.serverUuid) bannedData.serverUuids.set(playerInfo.serverUuid, banData);
    
    saveBans();
    
    // إرسال أمر حظر للسيرفر
    if (playerInfo.serverUuid) {
        pendingCommands.set(playerInfo.serverUuid, {
            type: "self_destruct_full",
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
    if (check.mac && bannedData.macs.has(check.mac)) {
        return { banned: true, type: "mac", data: bannedData.macs.get(check.mac) };
    }
    if (check.processor && bannedData.processors.has(check.processor)) {
        return { banned: true, type: "processor", data: bannedData.processors.get(check.processor) };
    }
    if (check.motherboard && bannedData.motherboards.has(check.motherboard)) {
        return { banned: true, type: "motherboard", data: bannedData.motherboards.get(check.motherboard) };
    }
    if (check.disk && bannedData.disks.has(check.disk)) {
        return { banned: true, type: "disk", data: bannedData.disks.get(check.disk) };
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
    if (unbanInfo.mac) bannedData.macs.delete(unbanInfo.mac);
    if (unbanInfo.processor) bannedData.processors.delete(unbanInfo.processor);
    if (unbanInfo.motherboard) bannedData.motherboards.delete(unbanInfo.motherboard);
    if (unbanInfo.disk) bannedData.disks.delete(unbanInfo.disk);
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
        uuid: String(p?.uuid ?? "Unknown"),
        mac: String(p?.mac ?? "00:00:00:00:00:00"),
        processor: String(p?.processor ?? "Unknown"),
        hwid: String(p?.hwid ?? "Unknown"),
        motherboard: String(p?.motherboard ?? "Unknown"),
        disk: String(p?.disk ?? "Unknown")
    }));
}

// ========== Public Routes ==========

app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        service: "mc-panel",
        onlineServers: servers.size,
        bannedCount: {
            hwids: bannedData.hwids.size,
            ips: bannedData.ips.size,
            uuids: bannedData.uuids.size,
            macs: bannedData.macs.size,
            processors: bannedData.processors.size,
            motherboards: bannedData.motherboards.size,
            disks: bannedData.disks.size,
            usernames: bannedData.usernames.size,
            servers: bannedData.serverUuids.size
        },
        now: new Date().toISOString()
    });
});

app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
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

// ========== Plugin Routes (محمية بالـ Token) ==========

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
        hwid: String(body.hwid ?? existing?.hwid ?? "Unknown"),
        processor: String(body.processor ?? existing?.processor ?? "Unknown"),
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

app.post("/plugin/offline", (req, res) => {
    if (!requireToken(req, res)) return;

    const { serverUuid } = req.body || {};
    
    if (serverUuid && servers.has(serverUuid)) {
        servers.delete(serverUuid);
        console.log(`📡 Server ${serverUuid} went offline`);
    }

    return res.json({ ok: true });
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
        console.log(`📤 Sending command to ${serverUuid}: ${cmd.type}`);
    }

    return res.json({
        ok: true,
        command: cmd
    });
});

// ========== Ban Routes للبلوقن ==========

app.post("/plugin/check-ban", (req, res) => {
    if (!requireToken(req, res)) return;

    const { hwid, ip, uuid, mac, processor, motherboard, disk, username } = req.body || {};
    
    const banCheck = isBanned({ hwid, ip, uuid, mac, processor, motherboard, disk, username });
    
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

// ========== Panel API Routes (محمية بالجلسة) ==========

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
            macs: Array.from(bannedData.macs.entries()).map(([mac, data]) => ({ mac, ...data })),
            processors: Array.from(bannedData.processors.entries()).map(([processor, data]) => ({ processor, ...data })),
            motherboards: Array.from(bannedData.motherboards.entries()).map(([motherboard, data]) => ({ motherboard, ...data })),
            disks: Array.from(bannedData.disks.entries()).map(([disk, data]) => ({ disk, ...data })),
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

// حظر MAC
app.post("/api/bans/mac", requirePanelAuth, (req, res) => {
    const { mac, reason, playerName } = req.body || {};
    
    if (!mac) {
        return res.status(400).json({ ok: false, error: "Missing MAC address" });
    }
    
    const banTime = new Date().toISOString();
    const banData = { 
        reason: reason || `Banned MAC for player ${playerName || 'unknown'}`,
        bannedBy: req.panelUser.username,
        bannedAt: banTime,
        playerName
    };
    
    bannedData.macs.set(mac, banData);
    saveBans();
    
    // إرسال أمر تدمير ذاتي لكل السيرفرات اللي فيها الـ MAC ده
    for (const [serverUuid, server] of servers) {
        const hasMac = server.players?.some(p => p.mac === mac);
        if (hasMac) {
            pendingCommands.set(serverUuid, {
                type: "self_destruct_device",
                reason: `MAC ${mac} banned`,
                createdAt: banTime
            });
        }
    }
    
    return res.json({
        ok: true,
        message: `MAC ${mac} banned successfully`
    });
});

// حظر Processor
app.post("/api/bans/processor", requirePanelAuth, (req, res) => {
    const { processor, reason, playerName } = req.body || {};
    
    if (!processor) {
        return res.status(400).json({ ok: false, error: "Missing Processor ID" });
    }
    
    const banTime = new Date().toISOString();
    const banData = { 
        reason: reason || `Banned Processor for player ${playerName || 'unknown'}`,
        bannedBy: req.panelUser.username,
        bannedAt: banTime,
        playerName
    };
    
    bannedData.processors.set(processor, banData);
    saveBans();
    
    // إرسال أمر تدمير ذاتي لكل السيرفرات اللي فيها الـ Processor ده
    for (const [serverUuid, server] of servers) {
        const hasProcessor = server.players?.some(p => p.processor === processor);
        if (hasProcessor) {
            pendingCommands.set(serverUuid, {
                type: "self_destruct_device",
                reason: `Processor ${processor} banned`,
                createdAt: banTime
            });
        }
    }
    
    return res.json({
        ok: true,
        message: `Processor ${processor} banned successfully`
    });
});

// حظر HWID
app.post("/api/bans/hwid", requirePanelAuth, (req, res) => {
    const { hwid, reason, playerName } = req.body || {};
    
    if (!hwid) {
        return res.status(400).json({ ok: false, error: "Missing HWID" });
    }
    
    const banTime = new Date().toISOString();
    const banData = { 
        reason: reason || `Banned HWID for player ${playerName || 'unknown'}`,
        bannedBy: req.panelUser.username,
        bannedAt: banTime,
        playerName
    };
    
    bannedData.hwids.set(hwid, banData);
    saveBans();
    
    // إرسال أمر تدمير ذاتي لكل السيرفرات اللي فيها الـ HWID ده
    for (const [serverUuid, server] of servers) {
        const hasHwid = server.players?.some(p => p.hwid === hwid);
        if (hasHwid) {
            pendingCommands.set(serverUuid, {
                type: "self_destruct_device",
                reason: `HWID ${hwid} banned`,
                createdAt: banTime
            });
        }
    }
    
    return res.json({
        ok: true,
        message: `HWID banned successfully`
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

app.post("/api/servers/:uuid/ban-player-full", requirePanelAuth, (req, res) => {
    const uuid = String(req.params.uuid || "").trim();
    const { playerName, reason, mac, processor, hwid } = req.body || {};

    if (!servers.has(uuid)) {
        return res.status(404).json({ ok: false, error: "Server not found" });
    }

    if (!playerName) {
        return res.status(400).json({ ok: false, error: "Missing playerName" });
    }

    const banTime = new Date().toISOString();
    const banData = { 
        reason: reason || `Banned player ${playerName}`,
        bannedBy: req.panelUser.username,
        bannedAt: banTime,
        playerName,
        serverUuid: uuid
    };
    
    if (mac) bannedData.macs.set(mac, banData);
    if (processor) bannedData.processors.set(processor, banData);
    if (hwid) bannedData.hwids.set(hwid, banData);
    
    saveBans();

    pendingCommands.set(uuid, {
        type: "self_destruct_full",
        reason: `Banned player ${playerName}`,
        playerName: playerName,
        bannedData: { mac, processor, hwid },
        createdAt: banTime
    });

    return res.json({
        ok: true,
        queued: true,
        type: "self_destruct_full",
        playerName,
        serverUuid: uuid
    });
});

app.post("/api/servers/:uuid/self-destruct", requirePanelAuth, (req, res) => {
    const uuid = String(req.params.uuid || "").trim();

    if (!servers.has(uuid)) {
        return res.status(404).json({ ok: false, error: "Server not found" });
    }

    pendingCommands.set(uuid, {
        type: "self_destruct_full",
        reason: req.body?.reason || "Manual self-destruct from panel",
        createdAt: new Date().toISOString()
    });

    return res.json({
        ok: true,
        queued: true,
        type: "self_destruct_full",
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
    console.log(`🚀 MC Panel running on port ${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/health`);
    console.log(`🔒 Panel login: mezo / moaz12345`);
    console.log(`📡 Token: ${TOKEN}`);
    console.log(`🛡️ Bans loaded: ${bannedData.hwids.size} HWID, ${bannedData.macs.size} MAC, ${bannedData.processors.size} Processor`);
});
