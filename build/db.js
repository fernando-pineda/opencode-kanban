#!/usr/bin/env node
import Database from "better-sqlite3";
import { readFileSync, realpathSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, basename } from "path";
import { homedir } from "os";
import { emitBoardChange } from "./event-bus.js";
// ── Database initialization ──────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_DIR = join(__dirname, __dirname.includes("build") ? "../src" : "");
const OPENCODE_DB_PATH = process.env.OPENCODE_DB_PATH ||
    join(homedir(), ".local", "share", "opencode", "opencode.db");
let db;
export function getDb() {
    return db;
}
function initDb() {
    const database = new Database(OPENCODE_DB_PATH);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    const schema = readFileSync(join(SRC_DIR, "schema.sql"), "utf-8");
    database.exec(schema);
    return database;
}
try {
    db = initDb();
    console.error(`[kanban-db] Connected to opencode.db: ${OPENCODE_DB_PATH}`);
}
catch (err) {
    console.error(`[kanban-db] Failed to initialize:`, err);
    process.exit(1);
}
// ── OpenCode session helpers ─────────────────────────────────
export function getSessionFirstUserMessage(sessionId) {
    try {
        const msg = db
            .prepare('SELECT id FROM message WHERE session_id = ? AND data LIKE \'%"role":"user"%\' ORDER BY time_created ASC LIMIT 1')
            .get(sessionId);
        if (!msg)
            return "";
        const part = db
            .prepare('SELECT data FROM part WHERE message_id = ? AND data LIKE \'%"type":"text"%\' ORDER BY time_created ASC LIMIT 1')
            .get(msg.id);
        if (!part)
            return "";
        const parsed = JSON.parse(part.data);
        if (parsed.text)
            return parsed.text.slice(0, 240);
        return "";
    }
    catch {
        return "";
    }
}
export function getSessionTokens(sessionId) {
    try {
        const row = db
            .prepare('SELECT data FROM message WHERE session_id = ? AND json_extract(data, \'$.role\') = \'assistant\' AND json_extract(data, \'$.tokens.total\') IS NOT NULL ORDER BY time_created DESC LIMIT 1')
            .get(sessionId);
        if (!row)
            return 0;
        const msg = JSON.parse(row.data);
        return msg.tokens?.total || 0;
    }
    catch {
        return 0;
    }
}
export function getSessionLatestAgent(sessionId) {
    try {
        const row = db
            .prepare("SELECT data FROM message WHERE session_id = ? AND json_extract(data, '$.agent') IS NOT NULL ORDER BY time_created DESC LIMIT 1")
            .get(sessionId);
        if (!row)
            return null;
        const parsed = JSON.parse(row.data);
        return parsed.agent || null;
    }
    catch {
        return null;
    }
}
export function getSessionExplicitColumn(sessionId) {
    try {
        const row = db
            .prepare("SELECT column_name FROM kanban_session_columns WHERE session_id = ?")
            .get(sessionId);
        return row?.column_name || null;
    }
    catch {
        return null;
    }
}
export function setSessionExplicitColumn(sessionId, columnName) {
    db.prepare("INSERT OR REPLACE INTO kanban_session_columns (session_id, column_name, updated_at) VALUES (?, ?, ?)").run(sessionId, columnName, new Date().toISOString());
}
function determineSessionColumn(sessionId, isCompleted, isArchived) {
    // 1. Check explicit column assignment (manual moves)
    const explicitColumn = getSessionExplicitColumn(sessionId);
    if (explicitColumn)
        return explicitColumn;
    // 2. Completed sessions
    if (isCompleted)
        return "Done";
    // 3. Archived sessions
    if (isArchived)
        return "Archived";
    // 4. Agent-based assignment
    const agent = getSessionLatestAgent(sessionId);
    if (agent) {
        const agentLower = agent.toLowerCase();
        // Planning/research agents → Backlog
        if (agentLower.includes("plan") ||
            agentLower.includes("ask") ||
            agentLower.includes("research")) {
            return "Backlog";
        }
        // Build/code agents → In Progress
        if (agentLower.includes("build") || agentLower.includes("code")) {
            return "In Progress";
        }
    }
    // 5. Default: Backlog (new sessions, PLAN agent, etc.)
    return "Backlog";
}
// ── Board functions ─────────────────────────────────────────
export function getOrCreateBoard(repoPath) {
    // Resolve symlinks to the real path
    try {
        repoPath = realpathSync(repoPath);
    }
    catch {
        // path doesn't exist yet, keep as-is
    }
    const existing = db
        .prepare("SELECT * FROM kanban_boards WHERE repo_path = ? AND status = ?")
        .get(repoPath, "active");
    if (existing)
        return existing;
    const name = basename(repoPath);
    const now = new Date().toISOString();
    const board = db
        .prepare("INSERT INTO kanban_boards (name, repo_path, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(name, repoPath, "active", now, now);
    const boardId = Number(board.lastInsertRowid);
    const defaultColumns = ["Backlog", "In Progress", "Done", "Archived"];
    const insertCol = db.prepare("INSERT OR IGNORE INTO kanban_columns (board_id, name, position) VALUES (?, ?, ?)");
    for (let i = 0; i < defaultColumns.length; i++) {
        insertCol.run(boardId, defaultColumns[i], i);
    }
    emitBoardChange("board_updated", { board_id: boardId });
    return {
        id: boardId,
        name,
        repo_path: repoPath,
        status: "active",
        created_at: now,
        updated_at: now,
    };
}
function ensureColumns(boardId) {
    const required = ["Backlog", "In Progress", "Done", "Archived"];
    const existing = listColumns(boardId).map((c) => c.name);
    const insertCol = db.prepare("INSERT OR IGNORE INTO kanban_columns (board_id, name, position) VALUES (?, ?, ?)");
    for (const name of required) {
        if (!existing.includes(name)) {
            const maxPos = db
                .prepare("SELECT COALESCE(MAX(position), -1) + 1 as pos FROM kanban_columns WHERE board_id = ?")
                .get(boardId);
            insertCol.run(boardId, name, maxPos.pos);
        }
    }
    // Reorder columns to correct positions: Backlog=0, In Progress=1, Done=2, Archived=3
    const updatePos = db.prepare("UPDATE kanban_columns SET position = ? WHERE board_id = ? AND name = ?");
    for (let i = 0; i < required.length; i++) {
        updatePos.run(i, boardId, required[i]);
    }
}
export function getBoard(boardId) {
    return (db
        .prepare("SELECT * FROM kanban_boards WHERE id = ?")
        .get(boardId) || null);
}
export function listBoards(repoPath) {
    if (repoPath) {
        return db
            .prepare("SELECT * FROM kanban_boards WHERE repo_path = ? AND status = ? ORDER BY updated_at DESC")
            .all(repoPath, "active");
    }
    return db
        .prepare("SELECT * FROM kanban_boards WHERE status = ? ORDER BY updated_at DESC")
        .all("active");
}
export function archiveBoard(boardId) {
    db.prepare("UPDATE kanban_boards SET status = 'archived', updated_at = ? WHERE id = ?").run(new Date().toISOString(), boardId);
    emitBoardChange("board_updated", { board_id: boardId });
}
// ── Column functions ────────────────────────────────────────
export function listColumns(boardId) {
    return db
        .prepare("SELECT * FROM kanban_columns WHERE board_id = ? ORDER BY position")
        .all(boardId);
}
export function getColumnByName(boardId, name) {
    return (db
        .prepare("SELECT * FROM kanban_columns WHERE board_id = ? AND LOWER(name) = LOWER(?)")
        .get(boardId, name) || null);
}
// ── Session move/complete functions ─────────────────────────
export function moveSessionToColumn(sessionId, toColumnName, boardId) {
    // Store explicit column assignment (persists manual moves)
    setSessionExplicitColumn(sessionId, toColumnName);
    // If moving to 'Done': INSERT into kanban_completed
    if (toColumnName === "Done") {
        db.prepare("INSERT OR IGNORE INTO kanban_completed (session_id) VALUES (?)").run(sessionId);
    }
    else {
        // If moving away from 'Done': DELETE from kanban_completed
        db.prepare("DELETE FROM kanban_completed WHERE session_id = ?").run(sessionId);
    }
    emitBoardChange("card_moved", {
        session_id: sessionId,
        to_column: toColumnName,
    });
}
export function markSessionCompleted(sessionId) {
    db.prepare("INSERT OR IGNORE INTO kanban_completed (session_id) VALUES (?)").run(sessionId);
    setSessionExplicitColumn(sessionId, "Done");
    emitBoardChange("card_moved", {
        session_id: sessionId,
        to_column: "Done",
    });
}
export function unmarkSessionCompleted(sessionId) {
    db.prepare("DELETE FROM kanban_completed WHERE session_id = ?").run(sessionId);
    // Remove explicit column assignment so it gets recomputed from agent
    db.prepare("DELETE FROM kanban_session_columns WHERE session_id = ?").run(sessionId);
}
// ── Search function ────────────────────────────────────────
export function searchCards(boardId, query) {
    const board = getBoard(boardId);
    if (!board)
        return [];
    const like = `%${query}%`;
    const sessions = db
        .prepare("SELECT id, directory, title, time_created, time_updated, time_compacting FROM session WHERE parent_id IS NULL AND id NOT IN (SELECT session_id FROM kanban_deleted_sessions) AND (title LIKE ? OR directory LIKE ?) ORDER BY time_updated DESC")
        .all(like, like);
    const completedSet = new Set(db.prepare("SELECT session_id FROM kanban_completed").all().map((r) => r.session_id));
    const nowMs = Date.now();
    const cards = [];
    for (const session of sessions) {
        if (session.directory !== board.repo_path &&
            !session.directory.startsWith(board.repo_path + "/"))
            continue;
        const isCompacting = !!(session.time_compacting && session.time_compacting > 0);
        const timeSinceUpdateSec = (nowMs - session.time_updated) / 1000;
        const isArchived = timeSinceUpdateSec >= 86400;
        const isCompleted = completedSet.has(session.id);
        const columnName = determineSessionColumn(session.id, isCompleted, isArchived);
        cards.push({
            session_id: session.id,
            title: session.title,
            description: getSessionFirstUserMessage(session.id),
            directory: session.directory,
            context_tokens: getSessionTokens(session.id),
            is_compacting: isCompacting,
            manually_completed: completedSet.has(session.id),
            time_created: new Date(session.time_created).toISOString(),
            time_updated: new Date(session.time_updated).toISOString(),
            column_name: columnName,
        });
    }
    return cards;
}
// ── Subtask functions ───────────────────────────────────────
export function createSubtask(sessionId, agentName, agentType, title = "", repository = "", worktree = "") {
    const now = new Date().toISOString();
    const result = db
        .prepare("INSERT INTO kanban_subtasks (session_id, agent_name, agent_type, title, repository, worktree, status, progress, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)")
        .run(sessionId, agentName, agentType, title, repository, worktree, now, now);
    const subtaskId = Number(result.lastInsertRowid);
    const subtask = {
        id: subtaskId,
        session_id: sessionId,
        agent_name: agentName,
        agent_type: agentType,
        title,
        repository,
        worktree,
        status: "pending",
        progress: 0,
        details: "",
        result_summary: "",
        created_at: now,
        updated_at: now,
        completed_at: null,
    };
    emitBoardChange("subtask_created", {
        session_id: sessionId,
        agent_name: agentName,
    });
    return subtask;
}
export function updateSubtask(subtaskId, data) {
    const subtask = db
        .prepare("SELECT * FROM kanban_subtasks WHERE id = ?")
        .get(subtaskId);
    if (!subtask)
        return null;
    const sets = [];
    const values = [];
    if (data.status !== undefined) {
        sets.push("status = ?");
        values.push(data.status);
        if (data.status === "completed" || data.status === "failed") {
            sets.push("completed_at = ?");
            values.push(new Date().toISOString());
        }
    }
    if (data.progress !== undefined) {
        sets.push("progress = ?");
        values.push(data.progress);
    }
    if (data.details !== undefined) {
        sets.push("details = ?");
        values.push(data.details);
    }
    if (data.result_summary !== undefined) {
        sets.push("result_summary = ?");
        values.push(data.result_summary);
    }
    if (sets.length === 0)
        return subtask;
    sets.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(subtaskId);
    db.prepare(`UPDATE kanban_subtasks SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    emitBoardChange("subtask_updated", {
        session_id: subtask.session_id,
        status: data.status || subtask.status,
        progress: data.progress ?? subtask.progress,
    });
    return (db.prepare("SELECT * FROM kanban_subtasks WHERE id = ?").get(subtaskId) || null);
}
export function getSubtasks(sessionId) {
    return db
        .prepare("SELECT * FROM kanban_subtasks WHERE session_id = ? ORDER BY repository, worktree, created_at")
        .all(sessionId);
}
export function deleteSubtask(subtaskId) {
    db.prepare("DELETE FROM kanban_subtasks WHERE id = ?").run(subtaskId);
}
// ── Agent log functions ─────────────────────────────────────
export function addAgentLog(sessionId, agentName, agentType, action, details = "", subtaskId) {
    const result = db
        .prepare("INSERT INTO kanban_agent_logs (session_id, subtask_id, agent_name, agent_type, action, details, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(sessionId, subtaskId ?? null, agentName, agentType, action, details, new Date().toISOString());
    const log = {
        id: Number(result.lastInsertRowid),
        session_id: sessionId,
        subtask_id: subtaskId ?? null,
        agent_name: agentName,
        agent_type: agentType,
        action,
        details,
        timestamp: new Date().toISOString(),
    };
    emitBoardChange("agent_log_added", {
        session_id: sessionId,
        agent_name: agentName,
        action,
    });
    return log;
}
export function getAgentLogs(sessionId) {
    return db
        .prepare("SELECT * FROM kanban_agent_logs WHERE session_id = ? ORDER BY timestamp")
        .all(sessionId);
}
// ── Full board retrieval ────────────────────────────────────
export function getBoardFull(boardId) {
    const board = getBoard(boardId);
    if (!board)
        throw new Error(`Board ${boardId} not found`);
    // Ensure all required columns exist
    ensureColumns(boardId);
    const columns = listColumns(boardId);
    // Get completed sessions
    const completedSet = new Set(db.prepare("SELECT session_id FROM kanban_completed").all().map((r) => r.session_id));
    // Get matching sessions (parent only, matching directory or subdirectory)
    const sessions = db
        .prepare("SELECT id, directory, title, time_created, time_updated, time_compacting FROM session WHERE parent_id IS NULL AND id NOT IN (SELECT session_id FROM kanban_deleted_sessions) ORDER BY time_updated DESC")
        .all();
    const nowMs = Date.now();
    const cards = [];
    for (const session of sessions) {
        if (session.directory !== board.repo_path &&
            !session.directory.startsWith(board.repo_path + "/"))
            continue;
        const isCompacting = !!(session.time_compacting && session.time_compacting > 0);
        const timeSinceUpdateSec = (nowMs - session.time_updated) / 1000;
        const isArchived = timeSinceUpdateSec >= 86400;
        const isCompleted = completedSet.has(session.id);
        // Determine column — agent-based (PLAN→Backlog, BUILD→In Progress)
        const columnName = determineSessionColumn(session.id, isCompleted, isArchived);
        cards.push({
            session_id: session.id,
            title: session.title,
            description: getSessionFirstUserMessage(session.id),
            directory: session.directory,
            context_tokens: getSessionTokens(session.id),
            is_compacting: isCompacting,
            manually_completed: completedSet.has(session.id),
            time_created: new Date(session.time_created).toISOString(),
            time_updated: new Date(session.time_updated).toISOString(),
            column_name: columnName,
            subtasks: [],
            agent_logs: [],
        });
    }
    // Attach subtasks and logs to each card
    for (const card of cards) {
        card.subtasks = getSubtasks(card.session_id);
        card.agent_logs = getAgentLogs(card.session_id);
    }
    return { board, columns, cards };
}
export function getSessionMessages(sessionId, limit = 50, offset = 0) {
    // Get session directory
    const sessionRow = db
        .prepare("SELECT directory, title FROM session WHERE id = ?")
        .get(sessionId);
    const sessionDirectory = sessionRow?.directory || null;
    const sessionTitle = sessionRow?.title || null;
    // Get total count
    const { total } = db
        .prepare("SELECT COUNT(*) as total FROM message WHERE session_id = ?")
        .get(sessionId);
    // Get paginated messages
    const messageRows = db
        .prepare("SELECT id, time_created, time_updated, data as msg_data FROM message WHERE session_id = ? ORDER BY time_created ASC LIMIT ? OFFSET ?")
        .all(sessionId, limit, offset);
    const messages = [];
    let sessionModel = null;
    for (const messageRow of messageRows) {
        let msgData;
        try {
            msgData = JSON.parse(messageRow.msg_data);
        }
        catch {
            console.error(`[kanban-db] Skipping malformed message ${messageRow.id}: JSON parse failed`);
            continue;
        }
        const role = msgData.role || "user";
        const model = msgData.model || null;
        const agent = msgData.agent || null;
        // Extract model from first user message if not set
        if (!sessionModel && role === "user" && model) {
            sessionModel = model;
        }
        // Get all parts for this message
        const partRows = db
            .prepare("SELECT data FROM part WHERE message_id = ? ORDER BY time_created ASC")
            .all(messageRow.id);
        let textContent = "";
        let reasoningContent = "";
        const toolCalls = [];
        const compactions = [];
        for (const partRow of partRows) {
            let partData;
            try {
                partData = JSON.parse(partRow.data);
            }
            catch {
                console.error(`[kanban-db] Skipping malformed part in message ${messageRow.id}: JSON parse failed`);
                continue;
            }
            if (partData.type === "text" && partData.text) {
                textContent += partData.text;
            }
            else if (partData.type === "reasoning" && partData.text) {
                reasoningContent += partData.text;
            }
            else if (partData.type === "tool") {
                const state = partData.state || {};
                toolCalls.push({
                    tool: partData.tool || "",
                    callID: partData.callID || "",
                    status: state.status,
                    input: state.input,
                    output: typeof state.output === "string" ? state.output : state.metadata?.output || "",
                });
            }
            else if (partData.type === "compaction") {
                compactions.push({
                    auto: partData.auto ?? false,
                    tail_start_id: partData.tail_start_id || "",
                });
            }
        }
        messages.push({
            id: messageRow.id,
            role: role,
            model,
            agent,
            time_created: messageRow.time_created,
            text: textContent,
            reasoning: reasoningContent,
            tool_calls: toolCalls,
            compactions,
        });
    }
    const contextTokens = getSessionTokens(sessionId);
    return {
        session_id: sessionId,
        title: sessionTitle,
        directory: sessionDirectory,
        model: sessionModel,
        total,
        context_tokens: contextTokens,
        messages,
    };
}
// ── Rules functions ──────────────────────────────────────────
export function listRules() {
    return db
        .prepare("SELECT * FROM kanban_rules ORDER BY position ASC, created_at ASC")
        .all();
}
export function createRule(title = "", content = "", enabled = true) {
    const maxPos = db
        .prepare("SELECT COALESCE(MAX(position), -1) + 1 as pos FROM kanban_rules")
        .get();
    const now = new Date().toISOString();
    const result = db
        .prepare("INSERT INTO kanban_rules (title, content, position, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(title, content, maxPos.pos, enabled ? 1 : 0, now, now);
    return {
        id: Number(result.lastInsertRowid),
        title,
        content,
        position: maxPos.pos,
        enabled,
        created_at: now,
        updated_at: now,
    };
}
export function updateRule(ruleId, data) {
    const rule = db
        .prepare("SELECT * FROM kanban_rules WHERE id = ?")
        .get(ruleId);
    if (!rule)
        return null;
    const sets = [];
    const values = [];
    if (data.title !== undefined) {
        sets.push("title = ?");
        values.push(data.title);
    }
    if (data.content !== undefined) {
        sets.push("content = ?");
        values.push(data.content);
    }
    if (data.enabled !== undefined) {
        sets.push("enabled = ?");
        values.push(data.enabled ? 1 : 0);
    }
    if (data.position !== undefined) {
        sets.push("position = ?");
        values.push(data.position);
    }
    if (sets.length === 0)
        return rule;
    sets.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(ruleId);
    db.prepare(`UPDATE kanban_rules SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return db.prepare("SELECT * FROM kanban_rules WHERE id = ?").get(ruleId) || null;
}
export function deleteRule(ruleId) {
    const result = db.prepare("DELETE FROM kanban_rules WHERE id = ?").run(ruleId);
    return result.changes > 0;
}
export function getEnabledRulesContent() {
    const rules = db
        .prepare("SELECT content FROM kanban_rules WHERE enabled = 1 ORDER BY position ASC")
        .all();
    return rules.map(r => r.content).join("\n\n");
}
// ── Settings functions ──────────────────────────────────────────
export function getSetting(key) {
    const row = db
        .prepare("SELECT value FROM kanban_settings WHERE key = ?")
        .get(key);
    return row?.value ?? null;
}
export function setSetting(key, value) {
    db.prepare("INSERT OR REPLACE INTO kanban_settings (key, value, updated_at) VALUES (?, ?, ?)").run(key, value, new Date().toISOString());
}
export function getAllSettings() {
    return db
        .prepare("SELECT * FROM kanban_settings ORDER BY key")
        .all();
}
export function getAutoCompactThreshold() {
    const val = getSetting("auto_compact_threshold");
    if (val === null)
        return 80; // default
    const num = parseInt(val, 10);
    return isNaN(num) ? 80 : Math.max(0, Math.min(100, num));
}
export function isAutoCompactEnabled() {
    const val = getSetting("auto_compact_enabled");
    if (val === null)
        return true; // default: enabled
    return val === "true" || val === "1";
}
// ── Session model helper ──────────────────────────────────────────
export function getSessionModel(sessionId) {
    try {
        const row = db
            .prepare("SELECT data FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'user' AND json_extract(data, '$.model') IS NOT NULL ORDER BY time_created ASC LIMIT 1")
            .get(sessionId);
        if (!row)
            return null;
        const msg = JSON.parse(row.data);
        return msg.model || null;
    }
    catch {
        return null;
    }
}
export function getActiveSessionIds() {
    const oneDayAgoMs = Date.now() - 86400000;
    return db
        .prepare("SELECT id, directory FROM session WHERE parent_id IS NULL AND time_updated > ? ORDER BY time_updated DESC")
        .all(oneDayAgoMs);
}
// ── Utility ────────────────────────────────────────────────
export function getDistinctRepos() {
    const rows = db
        .prepare("SELECT DISTINCT repo_path FROM kanban_boards WHERE status = ? ORDER BY repo_path")
        .all("active");
    return rows.map((r) => r.repo_path);
}
export function deleteSession(sessionId) {
    db.prepare("INSERT OR IGNORE INTO kanban_deleted_sessions (session_id) VALUES (?)").run(sessionId);
    db.prepare("DELETE FROM kanban_completed WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM kanban_session_columns WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM kanban_subtasks WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM kanban_agent_logs WHERE session_id = ?").run(sessionId);
    emitBoardChange("card_deleted", { session_id: sessionId });
}
export function closeDb() {
    db.close();
}
