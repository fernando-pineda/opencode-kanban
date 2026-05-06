#!/usr/bin/env node
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import os from "os";
import fs from "fs";
import { createServer, request as httpRequest } from "http";
import { setupTerminalServer } from "./terminal.js";
import { exec } from "child_process";
// ── Proxy to opencode's embedded HTTP server ──────────────
const OPENCODE_SERVER = process.env.OPENCODE_SERVER_URL || "http://127.0.0.1:4096";
// ── Hidden agents management ──────────────────────────────
const HIDDEN_AGENTS_PATH = path.join(os.homedir(), ".config/opencode/agents", ".hidden-agents.json");
function getHiddenAgents() {
    try {
        if (fs.existsSync(HIDDEN_AGENTS_PATH)) {
            const data = fs.readFileSync(HIDDEN_AGENTS_PATH, "utf-8");
            return JSON.parse(data);
        }
    }
    catch {
        // ignore
    }
    return [];
}
function setHiddenAgents(names) {
    const dir = path.dirname(HIDDEN_AGENTS_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(HIDDEN_AGENTS_PATH, JSON.stringify(names, null, 2), "utf-8");
}
function hideAgent(name) {
    const hidden = getHiddenAgents();
    if (!hidden.includes(name)) {
        hidden.push(name);
        setHiddenAgents(hidden);
    }
}
function unhideAgent(name) {
    const hidden = getHiddenAgents().filter((n) => n !== name);
    setHiddenAgents(hidden);
}
function getSessionDirectory(sessionId) {
    try {
        const row = getDb()
            .prepare("SELECT directory FROM session WHERE id = ?")
            .get(sessionId);
        return row?.directory || null;
    }
    catch {
        return null;
    }
}
/**
 * Build the combined mandatory context: rules + memories + knowledge for the session's repo.
 */
function getMandatoryContext(sessionId) {
    const parts = [];
    // 1. Rules (existing)
    const rulesContent = getEnabledRulesContent();
    if (rulesContent.trim()) {
        parts.push(rulesContent.trim());
    }
    // 2. Memories + Knowledge for the session's repo
    const repoPath = getSessionDirectory(sessionId);
    if (repoPath) {
        try {
            const knowledge = listKnowledge(repoPath, { limit: 50 });
            if (knowledge.length > 0) {
                const kText = knowledge
                    .map((e) => `[${e.category}/${e.key}] ${e.title}: ${e.content}`)
                    .join("\n");
                parts.push(`## Repository Knowledge (auto-loaded)\n${kText}`);
            }
        }
        catch { /* no knowledge table for this repo yet */ }
        try {
            const memories = getMemories(repoPath, { limit: 20 });
            if (memories.length > 0) {
                const mText = memories
                    .map((m) => `[${m.memory_type}] ${m.summary || (m.content || "").slice(0, 120)}`)
                    .join("\n");
                parts.push(`## Recent Memories (auto-loaded)\n${mText}`);
            }
        }
        catch { /* no memories table for this repo yet */ }
    }
    return parts.join("\n\n");
}
async function proxyToOpencode(req, res) {
    try {
        const originalPath = req.originalUrl.replace("/api/opencode", "");
        const proxyUrl = new URL(`${OPENCODE_SERVER}${originalPath}`);
        // Inject session directory for session-scoped routes if not already present
        const sessionMatch = originalPath.match(/^\/session\/([^/]+)\/(.+)/);
        if (sessionMatch && !proxyUrl.searchParams.has("directory")) {
            const sessionDir = getSessionDirectory(sessionMatch[1]);
            if (sessionDir)
                proxyUrl.searchParams.set("directory", sessionDir);
        }
        const url = proxyUrl.toString();
        const headers = {};
        if (req.headers["content-type"])
            headers["content-type"] = req.headers["content-type"];
        const body = req.body && Object.keys(req.body).length > 0
            ? JSON.stringify(req.body)
            : undefined;
        const opencodeRes = await fetch(url, {
            method: req.method,
            headers,
            body,
        });
        res
            .status(opencodeRes.status)
            .set("Content-Type", opencodeRes.headers.get("content-type") || "application/json");
        const text = await opencodeRes.text();
        res.send(text);
    }
    catch (err) {
        res
            .status(502)
            .json({
            error: `opencode server unreachable: ${err.message}`,
        });
    }
}
import { bus, EVENT_TYPES, emitBoardChange, } from "./event-bus.js";
import { listBoards, getBoardFull, getOrCreateBoard, archiveBoard, reorderBoards, moveSessionToColumn, searchCards, getSubtasks, createSubtask, updateSubtask, deleteSubtask, addAgentLog, getAgentLogs, getDistinctRepos, markSessionCompleted, unmarkSessionCompleted, getSessionMessages, getEnabledRulesContent, listRules, createRule, updateRule, deleteRule, getDb, getAllSettings, setSetting, getAutoCompactThreshold, isAutoCompactEnabled, getSessionTokens, getSessionModel, getActiveSessionIds, deleteSession, setSessionCompacting, isSessionCompacting, createNotification, getNotifications, getAllUnseenCounts, markNotificationSeen, markAllNotificationsSeen, markSessionNotificationsSeen, getNotificationBoardForSession, } from "./db.js";
import { searchMemories, getMemories, getMemoriesCount, getMemoriesStats, pruneMemories, getRepos as getMemoryRepos, searchKnowledge, getKnowledge, listKnowledge, getKnowledgeStats, getStaleKnowledge, deleteKnowledge, } from "./memories.js";
// ── Setup ────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = parseInt(process.env.WEB_PORT || "3210", 10);
const app = express();
// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
// ── Proxy to opencode embedded server ─────────────────────
app.all("/api/opencode/*", proxyToOpencode);
// ── Opencode serve restart (for agent reload) ───────────────
/** Restart opencode serve so it picks up new/modified agent files.
 *  Opencode caches agents in memory at startup with no reload API.
 *  This finds the running opencode serve process, kills it gracefully,
 *  and restarts it with the same arguments. The kanban SSE subscription
 *  auto-reconnects after 3-5 seconds.
 */
async function restartOpencodeServe() {
    return new Promise((resolve) => {
        // Find the opencode serve PID
        exec("pgrep -f 'opencode serve'", (err, stdout) => {
            if (err || !stdout.trim()) {
                resolve({ restarted: false, error: "opencode serve not running" });
                return;
            }
            const pid = parseInt(stdout.trim().split("\n")[0], 10);
            if (isNaN(pid)) {
                resolve({ restarted: false, error: "Could not determine opencode PID" });
                return;
            }
            // Get the process's working directory
            exec(`lsof -p ${pid} -Fn 2>/dev/null | grep '^n/' | head -1 | cut -c2-`, (cwdErr, cwdOut) => {
                const cwd = cwdOut?.trim() || os.homedir();
                // Send SIGTERM to opencode serve
                try {
                    process.kill(pid, "SIGTERM");
                }
                catch {
                    resolve({ restarted: false, error: `Failed to kill PID ${pid}` });
                    return;
                }
                // Wait for the process to die (port 4096 to free), then restart
                let attempts = 0;
                const maxAttempts = 30; // 15 seconds max
                const checkAndRestart = () => {
                    attempts++;
                    try {
                        process.kill(pid, 0); // throws if process is dead
                        if (attempts < maxAttempts) {
                            setTimeout(checkAndRestart, 500);
                            return;
                        }
                        resolve({ restarted: false, error: "Timeout waiting for opencode to stop" });
                        return;
                    }
                    catch {
                        // Process is dead, restart it
                    }
                    // Restart opencode serve in the background
                    const child = exec("nohup opencode serve > /dev/null 2>&1 &", { cwd }, (restartErr) => {
                        if (restartErr) {
                            resolve({ restarted: false, error: `Restart failed: ${restartErr.message}` });
                            return;
                        }
                    });
                    // Wait for port 4096 to be listening again
                    let readyAttempts = 0;
                    const maxReadyAttempts = 30;
                    const checkReady = () => {
                        readyAttempts++;
                        fetch(`${OPENCODE_SERVER}/provider`)
                            .then((r) => {
                            if (r.ok) {
                                resolve({ restarted: true });
                            }
                            else if (readyAttempts < maxReadyAttempts) {
                                setTimeout(checkReady, 500);
                            }
                            else {
                                resolve({ restarted: false, error: "opencode did not become ready in time" });
                            }
                        })
                            .catch(() => {
                            if (readyAttempts < maxReadyAttempts) {
                                setTimeout(checkReady, 500);
                            }
                            else {
                                resolve({ restarted: false, error: "opencode did not become ready in time" });
                            }
                        });
                    };
                    setTimeout(checkReady, 1000);
                    // Avoid unhandled rejection from the child process
                    child.unref();
                };
                setTimeout(checkAndRestart, 500);
            });
        });
    });
}
// ── Agent File Management ────────────────────────────────
// GET /api/agents/:name/file - Read agent markdown file
app.get("/api/agents/:name/file", (req, res) => {
    try {
        const { name } = req.params;
        // Validate agent name
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            res.status(400).json({ error: "Invalid agent name" });
            return;
        }
        const filePath = path.join(os.homedir(), ".config/opencode/agents", `${name}.md`);
        try {
            const content = fs.readFileSync(filePath, "utf-8");
            res.json({ name, content, path: filePath, exists: true });
        }
        catch (err) {
            if (err.code === "ENOENT") {
                res.json({ name, content: "", path: filePath, exists: false });
            }
            else {
                throw err;
            }
        }
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// PUT /api/agents/:name/file - Write agent markdown file
app.put("/api/agents/:name/file", (req, res) => {
    try {
        const { name } = req.params;
        const { content } = req.body;
        // Validate agent name
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            res.status(400).json({ error: "Invalid agent name" });
            return;
        }
        // Validate content
        if (content === undefined || content === null) {
            res.status(400).json({ error: "Content is required" });
            return;
        }
        const filePath = path.join(os.homedir(), ".config/opencode/agents", `${name}.md`);
        try {
            fs.writeFileSync(filePath, content, "utf-8");
            // Restart opencode serve to pick up the modified agent file
            restartOpencodeServe().then(({ restarted, error }) => {
                if (!restarted && error !== "opencode serve not running") {
                    console.warn(`[agents] opencode restart after save failed: ${error}`);
                }
            });
            res.json({ success: true, name });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/agents/hidden - Get list of hidden agent names
app.get("/api/agents/hidden", (_req, res) => {
    try {
        res.json({ hidden: getHiddenAgents() });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/agents/global-file - Read global AGENTS.md file
app.get("/api/agents/global-file", (_req, res) => {
    try {
        const filePath = path.join(os.homedir(), ".config/opencode/AGENTS.md");
        try {
            const content = fs.readFileSync(filePath, "utf-8");
            res.json({ content, path: filePath, exists: true });
        }
        catch (err) {
            if (err.code === "ENOENT") {
                res.json({ content: "", path: filePath, exists: false });
            }
            else {
                throw err;
            }
        }
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// PUT /api/agents/global-file - Write global AGENTS.md file
app.put("/api/agents/global-file", (req, res) => {
    try {
        const { content } = req.body;
        if (content === undefined || content === null) {
            res.status(400).json({ error: "Content is required" });
            return;
        }
        const filePath = path.join(os.homedir(), ".config/opencode/AGENTS.md");
        fs.writeFileSync(filePath, content, "utf-8");
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// DELETE /api/agents/:name/file - Delete agent markdown file
app.delete("/api/agents/:name/file", (req, res) => {
    try {
        const { name } = req.params;
        // Validate agent name
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            res.status(400).json({ error: "Invalid agent name" });
            return;
        }
        const filePath = path.join(os.homedir(), ".config/opencode/agents", `${name}.md`);
        try {
            // Delete the .md file if it exists
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            // Always hide from agent list
            hideAgent(name);
            res.json({ success: true, name });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ── Agents discovery (disk scan) ──────────────────────────
// GET /api/agents - List all agent files on disk with parsed frontmatter
app.get("/api/agents", (_req, res) => {
    try {
        const agentsDir = path.join(os.homedir(), ".config/opencode/agents");
        if (!fs.existsSync(agentsDir)) {
            res.json([]);
            return;
        }
        const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
        const agents = [];
        for (const file of files) {
            const name = file.replace(/\.md$/, "");
            const filePath = path.join(agentsDir, file);
            try {
                const content = fs.readFileSync(filePath, "utf-8");
                // Parse YAML frontmatter (simple key: value extraction)
                const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
                let mode = "primary";
                let description = name;
                let model = null;
                if (fmMatch) {
                    for (const line of fmMatch[1].split("\n")) {
                        const kv = line.match(/^(\w+):\s*(.+)$/);
                        if (kv) {
                            const [, key, val] = kv;
                            if (key === "mode")
                                mode = val.trim();
                            else if (key === "description")
                                description = val.trim();
                            else if (key === "model")
                                model = val.trim();
                        }
                    }
                }
                agents.push({ name, mode, description, model });
            }
            catch {
                // skip unreadable files
            }
        }
        res.json(agents);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ── Models API ───────────────────────────────────────────
// Cache available models from opencode
let cachedModels = [];
let modelsFetchedAt = 0;
// GET /api/models - List available models from opencode
app.get("/api/models", async (_req, res) => {
    try {
        const now = Date.now();
        if (now - modelsFetchedAt < 300000 && cachedModels.length > 0) {
            res.json(cachedModels);
            return;
        }
        const providerRes = await fetch(`${OPENCODE_SERVER}/provider`);
        if (!providerRes.ok) {
            res.json(cachedModels.length > 0 ? cachedModels : []);
            return;
        }
        const data = (await providerRes.json());
        const models = [];
        for (const provider of data.all) {
            if (data.connected && !data.connected.includes(provider.id))
                continue;
            for (const [modelId, model] of Object.entries(provider.models)) {
                models.push({
                    providerID: provider.id,
                    modelID: modelId,
                    name: model.name || modelId,
                });
            }
        }
        cachedModels = models;
        modelsFetchedAt = now;
        res.json(models);
    }
    catch {
        res.json(cachedModels.length > 0 ? cachedModels : []);
    }
});
// POST /api/agents - Create a new agent
app.post("/api/agents", (req, res) => {
    try {
        const { name, mode, description, model, content } = req.body;
        // Validate name
        if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
            res
                .status(400)
                .json({
                error: "Invalid agent name. Use only letters, numbers, hyphens, and underscores.",
            });
            return;
        }
        // Validate mode
        if (!mode || (mode !== "primary" && mode !== "subagent")) {
            res
                .status(400)
                .json({ error: "Mode must be 'primary' or 'subagent'" });
            return;
        }
        const agentsDir = path.join(os.homedir(), ".config/opencode/agents");
        const filePath = path.join(agentsDir, `${name}.md`);
        // Check file doesn't already exist
        if (fs.existsSync(filePath)) {
            res.status(409).json({ error: `Agent "${name}" already exists` });
            return;
        }
        // Build content
        let fileContent;
        if (content) {
            fileContent = content;
        }
        else {
            const desc = description || name;
            const modelLine = model ? `model: ${model}\n` : "";
            fileContent = `---\ndescription: ${desc}\nmode: ${mode}\n${modelLine}---\n\n# ${name} agent\n\n`;
        }
        // Ensure directory exists
        if (!fs.existsSync(agentsDir)) {
            fs.mkdirSync(agentsDir, { recursive: true });
        }
        fs.writeFileSync(filePath, fileContent, "utf-8");
        // Restart opencode serve to pick up the new agent file
        restartOpencodeServe().then(({ restarted, error }) => {
            if (!restarted && error !== "opencode serve not running") {
                console.warn(`[agents] opencode restart after create failed: ${error}`);
            }
        });
        res.json({ success: true, name });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ── Create new session via opencode ──────────────────────
app.post("/api/sessions", async (req, res) => {
    try {
        const { directory, board_id } = req.body;
        const url = new URL(`${OPENCODE_SERVER}/session`);
        if (directory)
            url.searchParams.set("directory", directory);
        const opencodeRes = await fetch(url.toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        if (!opencodeRes.ok) {
            const body = await opencodeRes.text().catch(() => "");
            res
                .status(opencodeRes.status)
                .json({ error: body || `opencode error ${opencodeRes.status}` });
            return;
        }
        const session = await opencodeRes.json();
        // Update session directory to match the requested directory
        if (directory) {
            try {
                const db = getDb();
                db.prepare("UPDATE session SET directory = ?, path = ? WHERE id = ?").run(directory, directory.replace(/^\//, ""), session.id);
            }
            catch {
                // non-critical: session created but directory may not match board
            }
        }
        // Emit SSE event so the board refreshes and shows the new card
        if (board_id) {
            emitBoardChange("card_created", { session_id: session.id, board_id });
        }
        else if (directory) {
            // Fallback: look up board from directory
            try {
                const board = getDb()
                    .prepare("SELECT id FROM kanban_boards WHERE repo_path = ? AND status = 'active'")
                    .get(directory);
                if (board) {
                    emitBoardChange("card_created", {
                        session_id: session.id,
                        board_id: board.id,
                    });
                }
            }
            catch {
                // non-critical
            }
        }
        // Return updated session with corrected directory
        res.json({
            ...session,
            directory: directory || session.directory,
            path: directory ? directory.replace(/^\//, "") : session.path,
        });
    }
    catch (err) {
        res
            .status(502)
            .json({
            error: `opencode server unreachable: ${err.message}`,
        });
    }
});
// ── Send message via opencode serve HTTP API ──────────────
app.post("/api/sessions/:sessionId/send", async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { text, agent } = req.body;
        if (!text?.trim()) {
            res.status(400).json({ error: "Message text is required" });
            return;
        }
        // Build parts array — inject mandatory rules + memories + knowledge
        const parts = [];
        const mandatoryContext = getMandatoryContext(sessionId);
        if (mandatoryContext.trim()) {
            parts.push({
                type: "text",
                text: `<mandatory>\n${mandatoryContext}\n</mandatory>`,
            });
        }
        parts.push({ type: "text", text: text.trim() });
        const sessionDir = getSessionDirectory(sessionId);
        const messageUrl = new URL(`${OPENCODE_SERVER}/session/${sessionId}/prompt_async`);
        if (sessionDir)
            messageUrl.searchParams.set("directory", sessionDir);
        const url = messageUrl.toString();
        const opencodeRes = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parts, ...(agent ? { agent } : {}) }),
        });
        if (!opencodeRes.ok) {
            const body = await opencodeRes.text().catch(() => "");
            res
                .status(opencodeRes.status)
                .json({ error: body || `opencode error ${opencodeRes.status}` });
            return;
        }
        // prompt_async returns 204 — respond immediately
        res.status(200).json({ ok: true });
    }
    catch (err) {
        res
            .status(502)
            .json({
            error: `opencode server unreachable: ${err.message}`,
        });
    }
});
// ── Question tool proxy (opencode question API) ──────────────────────
// GET pending questions
app.get("/api/opencode/question", async (req, res) => {
    try {
        const url = new URL(`${OPENCODE_SERVER}/question`);
        const dir = req.query.directory;
        if (dir)
            url.searchParams.set("directory", dir);
        const opencodeRes = await fetch(url.toString());
        if (!opencodeRes.ok) {
            const body = await opencodeRes.text().catch(() => "");
            res
                .status(opencodeRes.status)
                .json({ error: body || `opencode error ${opencodeRes.status}` });
            return;
        }
        const data = await opencodeRes.json();
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.json(data);
    }
    catch (err) {
        res
            .status(502)
            .json({
            error: `opencode server unreachable: ${err.message}`,
        });
    }
});
// POST reply to a question
app.post("/api/opencode/question/:questionId/reply", async (req, res) => {
    try {
        const { questionId } = req.params;
        const url = new URL(`${OPENCODE_SERVER}/question/${questionId}/reply`);
        const dir = req.query.directory;
        if (dir)
            url.searchParams.set("directory", dir);
        const opencodeRes = await fetch(url.toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
        });
        if (!opencodeRes.ok) {
            const body = await opencodeRes.text().catch(() => "");
            res
                .status(opencodeRes.status)
                .json({ error: body || `opencode error ${opencodeRes.status}` });
            return;
        }
        const data = await opencodeRes.json();
        res.json(data);
    }
    catch (err) {
        res
            .status(502)
            .json({
            error: `opencode server unreachable: ${err.message}`,
        });
    }
});
// POST reject a question
app.post("/api/opencode/question/:questionId/reject", async (req, res) => {
    try {
        const { questionId } = req.params;
        const url = new URL(`${OPENCODE_SERVER}/question/${questionId}/reject`);
        const dir = req.query.directory;
        if (dir)
            url.searchParams.set("directory", dir);
        const opencodeRes = await fetch(url.toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });
        if (!opencodeRes.ok) {
            const body = await opencodeRes.text().catch(() => "");
            res
                .status(opencodeRes.status)
                .json({ error: body || `opencode error ${opencodeRes.status}` });
            return;
        }
        const data = await opencodeRes.json();
        res.json(data);
    }
    catch (err) {
        res
            .status(502)
            .json({
            error: `opencode server unreachable: ${err.message}`,
        });
    }
});
// ── REST API Routes ─────────────────────────────────────────
// Boards
app.get("/api/boards", (req, res) => {
    try {
        const repoPath = req.query.repo_path;
        const boards = listBoards(repoPath);
        res.json(boards);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.get("/api/boards/:id", async (req, res) => {
    try {
        const boardId = parseInt(req.params.id, 10);
        const boardFull = getBoardFull(boardId);
        // Fetch session statuses from opencode to determine is_busy for each card
        // The directory parameter is required — without it the endpoint returns {}
        try {
            const statusUrl = new URL(`${OPENCODE_SERVER}/session/status`);
            if (boardFull.board.repo_path)
                statusUrl.searchParams.set("directory", boardFull.board.repo_path);
            const statusRes = await fetch(statusUrl.toString());
            if (statusRes.ok) {
                const statuses = (await statusRes.json());
                for (const card of boardFull.cards) {
                    card.is_busy =
                        statuses[card.session_id]?.type === "busy" ||
                            statuses[card.session_id]?.type === "retry" ||
                            false;
                }
            }
        }
        catch {
            // Status fetch is non-critical; cards default to is_busy = undefined
        }
        res.json(boardFull);
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
app.post("/api/boards/get-or-create", (req, res) => {
    try {
        const { repo_path } = req.body;
        if (!repo_path) {
            return res.status(400).json({ error: "repo_path is required" });
        }
        const board = getOrCreateBoard(repo_path);
        res.json(board);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.delete("/api/boards/:id", (req, res) => {
    try {
        const boardId = parseInt(req.params.id, 10);
        archiveBoard(boardId);
        res.json({ success: true });
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
app.put("/api/boards/reorder", (req, res) => {
    try {
        const { board_ids } = req.body;
        if (!Array.isArray(board_ids) || board_ids.length === 0) {
            return res.status(400).json({ error: "board_ids array is required" });
        }
        reorderBoards(board_ids);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Sessions/Cards
app.patch("/api/sessions/:sessionId/move", (req, res) => {
    try {
        const { sessionId } = req.params;
        const { to_column_name, board_id } = req.body;
        if (!to_column_name || !board_id) {
            return res
                .status(400)
                .json({ error: "to_column_name and board_id are required" });
        }
        moveSessionToColumn(sessionId, to_column_name, board_id);
        res.json({ success: true });
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
app.post("/api/sessions/:sessionId/complete", (req, res) => {
    try {
        const { sessionId } = req.params;
        markSessionCompleted(sessionId);
        res.json({ success: true });
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
app.post("/api/sessions/:sessionId/uncomplete", (req, res) => {
    try {
        const { sessionId } = req.params;
        unmarkSessionCompleted(sessionId);
        res.json({ success: true });
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
app.delete("/api/sessions/:sessionId", (req, res) => {
    try {
        const { sessionId } = req.params;
        deleteSession(sessionId);
        res.json({ success: true });
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
app.get("/api/cards/search", (req, res) => {
    try {
        const query = req.query.q;
        const boardId = req.query.board_id
            ? parseInt(req.query.board_id, 10)
            : undefined;
        if (!query || !boardId) {
            return res
                .status(400)
                .json({ error: "q (query) and board_id are required" });
        }
        const results = searchCards(boardId, query);
        res.json(results);
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
// Subtasks
app.get("/api/sessions/:sessionId/subtasks", (req, res) => {
    try {
        const { sessionId } = req.params;
        const subtasks = getSubtasks(sessionId);
        res.json(subtasks);
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
app.post("/api/sessions/:sessionId/subtasks", (req, res) => {
    try {
        const { sessionId } = req.params;
        const { agent_name, agent_type, title, repository, worktree } = req.body;
        if (!agent_name || !agent_type) {
            return res
                .status(400)
                .json({ error: "agent_name and agent_type are required" });
        }
        const subtask = createSubtask(sessionId, agent_name, agent_type, title || "", repository || "", worktree || "");
        res.json(subtask);
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
app.patch("/api/subtasks/:id", (req, res) => {
    try {
        const subtaskId = parseInt(req.params.id, 10);
        const { status, progress, details, result_summary } = req.body;
        const updated = updateSubtask(subtaskId, {
            status,
            progress,
            details,
            result_summary,
        });
        if (!updated) {
            return res.status(404).json({ error: "Subtask not found" });
        }
        res.json(updated);
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
app.delete("/api/subtasks/:id", (req, res) => {
    try {
        const subtaskId = parseInt(req.params.id, 10);
        deleteSubtask(subtaskId);
        res.json({ success: true });
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
// Agent logs
app.get("/api/sessions/:sessionId/logs", (req, res) => {
    try {
        const { sessionId } = req.params;
        const logs = getAgentLogs(sessionId);
        res.json(logs);
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
app.post("/api/sessions/:sessionId/logs", (req, res) => {
    try {
        const { sessionId } = req.params;
        const { agent_name, agent_type, action, details, subtask_id } = req.body;
        if (!agent_name || !agent_type || !action) {
            return res
                .status(400)
                .json({ error: "agent_name, agent_type, and action are required" });
        }
        const log = addAgentLog(sessionId, agent_name, agent_type, action, details || "", subtask_id);
        res.json(log);
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
// Session messages (paginated)
app.get("/api/sessions/:sessionId/messages", (req, res) => {
    try {
        const { sessionId } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const messagesData = getSessionMessages(sessionId, limit, offset);
        res.json(messagesData);
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
// Repos
app.get("/api/repos", (req, res) => {
    try {
        const repos = getDistinctRepos();
        res.json(repos);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ── Memories API ──────────────────────────────────────────────
// Search memories
app.get("/api/memories/search", (req, res) => {
    try {
        const repo_path = req.query.repo_path;
        const query = req.query.query;
        if (!repo_path || !query) {
            return res.status(400).json({ error: "repo_path and query are required" });
        }
        const results = searchMemories(repo_path, {
            query,
            agentName: req.query.agent_name,
            memoryType: req.query.memory_type,
            conversationId: req.query.conversation_id,
            limit: parseInt(req.query.limit) || 20,
        });
        res.json({ count: results.length, memories: results });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// List memories (paginated)
app.get("/api/memories", (req, res) => {
    try {
        const repo_path = req.query.repo_path;
        if (!repo_path) {
            return res.status(400).json({ error: "repo_path is required" });
        }
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const memoryType = req.query.memory_type;
        const results = getMemories(repo_path, {
            conversationId: req.query.conversation_id,
            agentName: req.query.agent_name,
            memoryType,
            limit,
            offset,
        });
        const total = getMemoriesCount(repo_path, { memoryType });
        res.json({ count: results.length, total, memories: results });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Prune memories
app.post("/api/memories/prune", (req, res) => {
    try {
        const { repo_path, keep_days, keep_important } = req.body;
        if (!repo_path) {
            return res.status(400).json({ error: "repo_path is required" });
        }
        const removed = pruneMemories(repo_path, {
            keepDays: keep_days || 90,
            keepImportant: keep_important !== false,
        });
        res.json({ removed });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// List repos with memories
app.get("/api/memories/repos", (_req, res) => {
    try {
        const repos = getMemoryRepos();
        res.json({ count: repos.length, repos });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Memories stats (counts per type)
app.get("/api/memories/stats", (req, res) => {
    try {
        const repo_path = req.query.repo_path;
        if (!repo_path) {
            return res.status(400).json({ error: "repo_path is required" });
        }
        const stats = getMemoriesStats(repo_path);
        res.json(stats);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Search knowledge
app.get("/api/knowledge/search", (req, res) => {
    try {
        const repo_path = req.query.repo_path;
        const query = req.query.query;
        if (!repo_path || !query) {
            return res.status(400).json({ error: "repo_path and query are required" });
        }
        const results = searchKnowledge(repo_path, {
            query,
            category: req.query.category,
            limit: parseInt(req.query.limit) || 30,
        });
        res.json({ count: results.length, entries: results });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Get specific knowledge entry
app.get("/api/knowledge/entry", (req, res) => {
    try {
        const repo_path = req.query.repo_path;
        const category = req.query.category;
        const key = req.query.key;
        if (!repo_path || !category || !key) {
            return res.status(400).json({ error: "repo_path, category, and key are required" });
        }
        const result = getKnowledge(repo_path, { category, key });
        if (!result) {
            return res.status(404).json({ error: "Entry not found" });
        }
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// List knowledge entries
app.get("/api/knowledge", (req, res) => {
    try {
        const repo_path = req.query.repo_path;
        if (!repo_path) {
            return res.status(400).json({ error: "repo_path is required" });
        }
        const limit = parseInt(req.query.limit) || 200;
        const offset = parseInt(req.query.offset) || 0;
        const category = req.query.category;
        const results = listKnowledge(repo_path, {
            category,
            limit,
            offset,
        });
        const stats = getKnowledgeStats(repo_path);
        res.json({ count: results.length, total: stats.total, entries: results });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Knowledge stats
app.get("/api/knowledge/stats", (req, res) => {
    try {
        const repo_path = req.query.repo_path;
        if (!repo_path) {
            return res.status(400).json({ error: "repo_path is required" });
        }
        const stats = getKnowledgeStats(repo_path);
        res.json(stats);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Stale knowledge
app.get("/api/knowledge/stale", (req, res) => {
    try {
        const repo_path = req.query.repo_path;
        if (!repo_path) {
            return res.status(400).json({ error: "repo_path is required" });
        }
        const results = getStaleKnowledge(repo_path, {
            category: req.query.category,
            olderThanDays: parseInt(req.query.older_than_days) || 7,
            limit: parseInt(req.query.limit) || 100,
        });
        res.json({ count: results.length, entries: results });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Delete knowledge entry
app.delete("/api/knowledge", (req, res) => {
    try {
        const repo_path = req.query.repo_path;
        const category = req.query.category;
        const key = req.query.key;
        if (!repo_path || !category || !key) {
            return res.status(400).json({ error: "repo_path, category, and key are required" });
        }
        const deleted = deleteKnowledge(repo_path, { category, key });
        res.json({ deleted });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ── Rules ─────────────────────────────────────────────────────
app.get("/api/rules", (req, res) => {
    try {
        const rules = listRules();
        res.json(rules);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post("/api/rules", (req, res) => {
    try {
        const { title, content, enabled } = req.body;
        const rule = createRule(title || "", content || "", enabled !== false);
        res.json(rule);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.put("/api/rules/:id", (req, res) => {
    try {
        const ruleId = parseInt(req.params.id, 10);
        const { title, content, enabled, position } = req.body;
        const updated = updateRule(ruleId, { title, content, enabled, position });
        if (!updated) {
            return res.status(404).json({ error: "Rule not found" });
        }
        res.json(updated);
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
app.delete("/api/rules/:id", (req, res) => {
    try {
        const ruleId = parseInt(req.params.id, 10);
        const deleted = deleteRule(ruleId);
        if (!deleted) {
            return res.status(404).json({ error: "Rule not found" });
        }
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ── Notifications API ─────────────────────────────────────────
// GET /api/notifications — get all notifications for a board
app.get("/api/notifications", (req, res) => {
    try {
        const boardId = parseInt(req.query.board_id, 10);
        if (!boardId) {
            return res.status(400).json({ error: "board_id query param is required" });
        }
        const notifications = getNotifications(boardId);
        res.json(notifications);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// GET /api/notifications/unseen-counts — get unseen counts for all boards
app.get("/api/notifications/unseen-counts", (_req, res) => {
    try {
        const counts = getAllUnseenCounts();
        res.json(counts);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// POST /api/notifications/:id/seen — mark one notification as seen
app.post("/api/notifications/:id/seen", (req, res) => {
    try {
        const notificationId = parseInt(req.params.id, 10);
        const found = markNotificationSeen(notificationId);
        if (!found) {
            return res.status(404).json({ error: "Notification not found" });
        }
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// POST /api/notifications/mark-all-seen — mark all notifications as seen for a board
app.post("/api/notifications/mark-all-seen", (req, res) => {
    try {
        const { board_id } = req.body;
        if (!board_id) {
            return res.status(400).json({ error: "board_id is required" });
        }
        const count = markAllNotificationsSeen(board_id);
        res.json({ success: true, count });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// POST /api/sessions/:sessionId/notifications/seen — mark all notifications for a session as seen
app.post("/api/sessions/:sessionId/notifications/seen", (req, res) => {
    try {
        const { sessionId } = req.params;
        const count = markSessionNotificationsSeen(sessionId);
        res.json({ success: true, count });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ── Server-Sent Events (SSE) ────────────────────────────────
app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const handler = (payload) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    // Listen to all event types
    const cleanup = [];
    for (const eventType of Object.values(EVENT_TYPES)) {
        const typedHandler = (payload) => handler({ type: eventType, ...payload });
        bus.on(eventType, typedHandler);
        cleanup.push(() => bus.off(eventType, typedHandler));
    }
    // Also relay opencode session status events
    const statusHandler = (payload) => {
        handler({ type: "opencode_session_status", ...payload });
    };
    bus.on("opencode_session_status", statusHandler);
    cleanup.push(() => bus.off("opencode_session_status", statusHandler));
    req.on("close", () => {
        cleanup.forEach((fn) => fn());
    });
});
// Filesystem browsing for workspace picker
app.get("/api/filesystem", (req, res) => {
    try {
        let dirPath = req.query.path || "/";
        // Expand home directory
        if (dirPath === "~" || dirPath.startsWith("~/")) {
            dirPath = os.homedir() + dirPath.slice(1);
        }
        // Security: only allow absolute paths
        if (!path.isAbsolute(dirPath)) {
            res.status(400).json({ error: "Absolute path required" });
            return;
        }
        // Read directory
        const entries = fs
            .readdirSync(dirPath, { withFileTypes: true })
            .filter((entry) => {
            // Skip hidden files/dirs
            if (entry.name.startsWith("."))
                return false;
            // Accept directories or symlinks (to directories)
            return entry.isDirectory() || entry.isSymbolicLink();
        })
            .map((entry) => ({
            name: entry.name,
            path: path.join(dirPath, entry.name),
            has_children: false, // we'll check on demand
            is_symlink: entry.isSymbolicLink(),
        }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
        res.json({
            path: dirPath,
            parent: path.dirname(dirPath),
            entries,
        });
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
// File search for @ mentions
app.get("/api/filesystem/search-files", (req, res) => {
    try {
        let dirPath = req.query.directory || "";
        const query = (req.query.query || "").toLowerCase();
        if (!dirPath) {
            res.status(400).json({ error: "directory is required" });
            return;
        }
        // Expand home directory
        if (dirPath === "~" || dirPath.startsWith("~/")) {
            dirPath = os.homedir() + dirPath.slice(1);
        }
        // Security: only allow absolute paths
        if (!path.isAbsolute(dirPath)) {
            res.status(400).json({ error: "Absolute path required" });
            return;
        }
        const skipDirs = new Set([
            "node_modules",
            ".git",
            "dist",
            "build",
            ".next",
            ".cache",
            "__pycache__",
            ".tox",
            ".venv",
            "venv",
            "target",
            ".gradle",
            ".idea",
            ".vscode",
            ".DS_Store",
            "coverage",
            ".turbo",
        ]);
        const files = [];
        const MAX_RESULTS = 200;
        try {
            const entries = fs.readdirSync(dirPath, {
                recursive: true,
                withFileTypes: false,
            });
            for (const entry of entries) {
                if (files.length >= MAX_RESULTS)
                    break;
                // Skip hidden files/dirs
                const parts = entry.split("/");
                if (parts.some((p) => p.startsWith(".") || skipDirs.has(p)))
                    continue;
                const fullPath = path.join(dirPath, entry);
                try {
                    const stat = fs.statSync(fullPath);
                    if (!stat.isFile())
                        continue;
                }
                catch {
                    continue;
                }
                const relativePath = entry;
                const name = path.basename(entry);
                // Apply query filter
                if (query && !relativePath.toLowerCase().includes(query))
                    continue;
                files.push({ name, relativePath });
            }
        }
        catch {
            // Directory may not exist or be unreadable
        }
        res.json({ files });
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
// ── General Settings ────────────────────────────────────────
app.get("/api/settings", (_req, res) => {
    try {
        const settings = getAllSettings();
        res.json(settings);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.put("/api/settings", (req, res) => {
    try {
        const updates = req.body;
        if (!updates || typeof updates !== "object") {
            return res
                .status(400)
                .json({ error: "Object with key/value pairs required" });
        }
        for (const [key, value] of Object.entries(updates)) {
            if (typeof key !== "string" || typeof value !== "string")
                continue;
            setSetting(key, value);
        }
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ── Backend Reload ──────────────────────────────────────────
app.post("/api/reload", (_req, res) => {
    try {
        const projectRoot = path.join(__dirname, "..");
        res.json({
            success: true,
            message: "Rebuild started. Server will restart shortly.",
        });
        // Run build asynchronously after sending response
        exec("npm run build", { cwd: projectRoot }, (error, _stdout, stderr) => {
            if (error) {
                console.error("[reload] Build failed:", stderr || error.message);
                return;
            }
            console.log("[reload] Build succeeded. Exiting for launchd restart...");
            // launchd KeepAlive=true will automatically restart the service
            setTimeout(() => process.exit(0), 500);
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ── Compaction proxy ────────────────────────────────────────
/** Extract providerID and modelID from a session's model data */
function getSessionModelParts(sessionId) {
    const raw = getSessionModel(sessionId);
    if (!raw)
        return null;
    try {
        // Model may already be an object { providerID, modelID }
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed &&
            typeof parsed === "object" &&
            parsed.providerID &&
            parsed.modelID) {
            return { providerID: parsed.providerID, modelID: parsed.modelID };
        }
    }
    catch { }
    // Fallback: if it's a dotted string like "provider.model"
    if (typeof raw === "string" && raw.includes(".")) {
        const idx = raw.indexOf(".");
        return {
            providerID: raw.substring(0, idx),
            modelID: raw.substring(idx + 1),
        };
    }
    return null;
}
app.post("/api/sessions/:sessionId/compact", async (req, res) => {
    try {
        const { sessionId } = req.params;
        const sessionDir = getSessionDirectory(sessionId);
        const modelParts = getSessionModelParts(sessionId);
        if (!modelParts) {
            return res
                .status(400)
                .json({ error: "Cannot determine model for session" });
        }
        // Already compacting?
        if (isSessionCompacting(sessionId)) {
            return res.status(409).json({ error: "Session is already compacting" });
        }
        // Mark as compacting immediately (so kanban cards + polling reflect it)
        setSessionCompacting(sessionId, true);
        // Return 202 Accepted immediately — compaction runs in background
        res.status(202).json({ success: true, status: "compacting" });
        // Fire summarize asynchronously
        const summarizeUrl = new URL(`${OPENCODE_SERVER}/session/${sessionId}/summarize`);
        if (sessionDir)
            summarizeUrl.searchParams.set("directory", sessionDir);
        fetch(summarizeUrl.toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                providerID: modelParts.providerID,
                modelID: modelParts.modelID,
                auto: false,
            }),
        })
            .then((opencodeRes) => {
            if (!opencodeRes.ok) {
                console.error(`[compact] summarize failed for ${sessionId}: ${opencodeRes.status}`);
            }
        })
            .catch((err) => {
            console.error(`[compact] summarize error for ${sessionId}:`, err.message);
        })
            .finally(() => {
            // Always clear the compacting flag
            setSessionCompacting(sessionId, false);
            console.log(`[compact] completed for ${sessionId}`);
        });
    }
    catch (err) {
        // If headers not yet sent, send error; otherwise just log
        if (!res.headersSent) {
            res
                .status(502)
                .json({
                error: `opencode server unreachable: ${err.message}`,
            });
        }
        // Clear compacting flag if we set it
        const { sessionId } = req.params;
        if (sessionId)
            setSessionCompacting(sessionId, false);
    }
});
app.get("/api/sessions/:sessionId/compacting", async (_req, res) => {
    const { sessionId } = _req.params;
    const compacting = isSessionCompacting(sessionId);
    res.json({ compacting });
});
// ── Auto-compact monitor ──────────────────────────────────────
// Cache provider context limits from opencode
let cachedContextLimits = {};
let contextLimitsFetchedAt = 0;
async function fetchContextLimits() {
    const now = Date.now();
    // Cache for 5 minutes
    if (now - contextLimitsFetchedAt < 300000 &&
        Object.keys(cachedContextLimits).length > 0) {
        return cachedContextLimits;
    }
    try {
        const res = await fetch(`${OPENCODE_SERVER}/provider`);
        if (!res.ok)
            return cachedContextLimits;
        const data = (await res.json());
        const limits = {};
        for (const provider of data.all) {
            if (data.connected && !data.connected.includes(provider.id))
                continue;
            for (const [modelId, model] of Object.entries(provider.models)) {
                const ctx = model.limit?.context;
                if (ctx && !limits[modelId])
                    limits[modelId] = ctx;
            }
        }
        cachedContextLimits = limits;
        contextLimitsFetchedAt = now;
    }
    catch {
        // opencode server may be temporarily unreachable
    }
    return cachedContextLimits;
}
async function checkAutoCompact() {
    if (!isAutoCompactEnabled())
        return;
    const threshold = getAutoCompactThreshold();
    if (threshold <= 0)
        return;
    const limits = await fetchContextLimits();
    if (Object.keys(limits).length === 0)
        return;
    const activeSessions = getActiveSessionIds();
    for (const session of activeSessions) {
        try {
            const tokens = getSessionTokens(session.id);
            if (tokens <= 0)
                continue;
            const modelParts = getSessionModelParts(session.id);
            if (!modelParts)
                continue;
            const limit = limits[modelParts.modelID];
            if (!limit || limit <= 0)
                continue;
            const ratio = tokens / limit;
            if (ratio >= threshold / 100) {
                // Trigger compaction via opencode API
                const compactUrl = new URL(`${OPENCODE_SERVER}/session/${session.id}/summarize`);
                if (session.directory)
                    compactUrl.searchParams.set("directory", session.directory);
                setSessionCompacting(session.id, true);
                await fetch(compactUrl.toString(), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        providerID: modelParts.providerID,
                        modelID: modelParts.modelID,
                        auto: true,
                    }),
                })
                    .catch(() => { })
                    .finally(() => {
                    setSessionCompacting(session.id, false);
                });
            }
        }
        catch {
            // non-critical per-session failure
        }
    }
}
// Run auto-compact check every 30 seconds
setInterval(checkAutoCompact, 30000);
// Initial check after 10 seconds (let server start up)
setTimeout(checkAutoCompact, 10000);
// ── OpenCode SSE Relay ──────────────────────────────────────
// Subscribe to opencode's SSE event stream and relay session.status events
// through the kanban event bus so the frontend gets immediate updates.
/** Try to extract valid JSON from an SSE data line, handling double-prefixed data */
function safeParseSSELine(line) {
    if (!line.startsWith("data: "))
        return null;
    let jsonStr = line.slice(6);
    // Handle double-prefixed data: "data: {"id":"data: {…}"}"
    // If the JSON string starts with { and contains "data: " as a value, try stripping the outer wrapper
    try {
        return JSON.parse(jsonStr);
    }
    catch {
        // Try to find the inner JSON object if the outer one is malformed
        const innerMatch = jsonStr.match(/"data:\s*(\{.*\})"/s);
        if (innerMatch) {
            try {
                return JSON.parse(innerMatch[1]);
            }
            catch {
                // Give up
            }
        }
    }
    return null;
}
function subscribeToOpencodeEvents() {
    // We need to subscribe to the SSE stream per-workspace (directory).
    // Subscribe to each active board's workspace and relay all events.
    const connect = (directory) => {
        try {
            const url = new URL(`${OPENCODE_SERVER}/event`);
            if (directory)
                url.searchParams.set("directory", directory);
            const req = httpRequest(url, (upstreamRes) => {
                let buffer = "";
                upstreamRes.on("data", (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || "";
                    for (const line of lines) {
                        if (line.startsWith("data: ")) {
                            try {
                                const eventData = JSON.parse(line.slice(6));
                                if (eventData.type === "session.status" &&
                                    eventData.properties?.sessionID) {
                                    const sessionID = eventData.properties.sessionID;
                                    const currentStatus = eventData.properties.status?.type || eventData.properties.status;
                                    const previousStatus = previousSessionStatuses.get(sessionID);
                                    bus.emit("opencode_session_status", {
                                        sessionID,
                                        status: eventData.properties.status,
                                    });
                                    // Auto-notification: detect busy/retry → idle transition
                                    if (previousStatus &&
                                        (previousStatus === "busy" || previousStatus === "retry") &&
                                        currentStatus === "idle") {
                                        try {
                                            const boardId = getNotificationBoardForSession(sessionID);
                                            if (boardId) {
                                                createNotification(boardId, sessionID, "iteration_complete", "");
                                            }
                                        }
                                        catch {
                                            // non-critical: notification creation failed
                                        }
                                    }
                                    previousSessionStatuses.set(sessionID, currentStatus);
                                }
                                // Relay streaming message events to frontend via event bus
                                if (eventData.type === "message.part.updated" && eventData.properties?.sessionID) {
                                    bus.emit("opencode_message_part_updated", {
                                        sessionID: eventData.properties.sessionID,
                                        part: eventData.properties.part,
                                    });
                                }
                                if (eventData.type === "message.updated" && eventData.properties?.sessionID) {
                                    bus.emit("opencode_message_updated", {
                                        sessionID: eventData.properties.sessionID,
                                        info: eventData.properties.info,
                                    });
                                }
                            }
                            catch {
                                // ignore parse errors
                            }
                        }
                    }
                });
                upstreamRes.on("end", () => {
                    setTimeout(() => connect(directory), 3000);
                });
            });
            req.on("error", () => {
                setTimeout(() => connect(directory), 5000);
            });
            req.end();
        }
        catch {
            setTimeout(() => connect(directory), 5000);
        }
    };
    // Connect for each active board's workspace
    try {
        const boards = listBoards();
        for (const board of boards) {
            if (board.repo_path)
                connect(board.repo_path);
        }
    }
    catch {
        // retry later
    }
}
// Track previous session statuses for auto-notification detection
const previousSessionStatuses = new Map();
subscribeToOpencodeEvents();
// Auto-notification: when a subtask is completed or failed, create a notification
bus.on("subtask_updated", (payload) => {
    try {
        const { session_id, status } = payload;
        if (status === "completed" || status === "failed") {
            const boardId = getNotificationBoardForSession(session_id);
            if (boardId) {
                const type = status === "completed" ? "subtask_complete" : "task_failed";
                createNotification(boardId, session_id, type, "");
            }
        }
    }
    catch {
        // non-critical: notification creation failed
    }
});
// ── Static Files & SPA Fallback ────────────────────────────
const distPath = path.join(__dirname, "..", "dist", "web");
app.use(express.static(distPath));
app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
});
// ── Start Server ────────────────────────────────────────────
const server = createServer(app);
setupTerminalServer(server);
server.listen(PORT, () => {
    console.log(`Kanban MCP web UI: http://localhost:${PORT}`);
});
