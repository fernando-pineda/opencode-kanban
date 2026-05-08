#!/usr/bin/env node

import Database from "better-sqlite3";
import { readFileSync, realpathSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, basename } from "path";
import { homedir } from "os";
import type {
  Board,
  Column,
  Card,
  Subtask,
  AgentLog,
  BoardFull,
  Rule,
  Setting,
  Epic,
  EpicSession,
} from "./types.js";
import { emitBoardChange } from "./event-bus.js";

// ── Database initialization ──────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_DIR = join(__dirname, __dirname.includes("build") ? "../src" : "");

const OPENCODE_DB_PATH =
  process.env.OPENCODE_DB_PATH ||
  join(homedir(), ".local", "share", "opencode", "opencode.db");

let db: Database.Database;

export function getDb(): Database.Database {
  return db;
}

function initDb(): Database.Database {
  const database = new Database(OPENCODE_DB_PATH);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  const schema = readFileSync(join(SRC_DIR, "schema.sql"), "utf-8");
  database.exec(schema);
  return database;
}

function migrateAddReadyStatus(): void {
  try {
    // Check if 'ready' is already in the constraint
    const epicCheck = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='kanban_epics'",
      )
      .get() as { sql: string } | undefined;

    if (epicCheck?.sql && !epicCheck.sql.includes("'ready'")) {
      console.error(
        "[kanban-db] Migrating kanban_epics: adding 'ready' status...",
      );
      db.exec(`
        CREATE TABLE IF NOT EXISTS kanban_epics_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          board_id INTEGER NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
          task_key TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          plan_text TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'planning'
            CHECK(status IN ('planning', 'ready', 'spawning', 'running', 'completed', 'failed')),
          planner_session_id TEXT,
          column_name TEXT NOT NULL DEFAULT 'Backlog',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          UNIQUE(board_id, task_key)
        );
        INSERT INTO kanban_epics_new SELECT * FROM kanban_epics;
        DROP TABLE kanban_epics;
        ALTER TABLE kanban_epics_new RENAME TO kanban_epics;
      `);
      console.error("[kanban-db] Migration complete: 'ready' status added.");
    }
  } catch (err) {
    console.error("[kanban-db] Migration error (non-fatal):", err);
  }
}

function migrateAddBoardPosition(): void {
  try {
    // Check if 'position' column exists on kanban_boards
    const tableInfo = db
      .prepare("PRAGMA table_info(kanban_boards)")
      .all() as Array<{ name: string }>;

    const hasPosition = tableInfo.some((col) => col.name === "position");
    if (!hasPosition) {
      console.error(
        "[kanban-db] Migrating kanban_boards: adding position column...",
      );
      db.exec(
        "ALTER TABLE kanban_boards ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
      );
      // Assign initial positions to existing boards
      db.prepare(
        "UPDATE kanban_boards SET position = id WHERE position = 0",
      ).run();
      console.error("[kanban-db] Migration complete: position column added.");
    }
  } catch (err) {
    console.error("[kanban-db] Migration error (non-fatal):", err);
  }
}

function migrateAddGitHubConfigs(): void {
  try {
    const tableInfo = db
      .prepare("PRAGMA table_info(kanban_github_configs)")
      .all() as Array<{ name: string }>;
    if (tableInfo.length === 0) {
      console.error("[kanban-db] Creating kanban_github_configs table...");
      db.exec(`
        CREATE TABLE IF NOT EXISTS kanban_github_configs (
          board_id INTEGER PRIMARY KEY REFERENCES kanban_boards(id) ON DELETE CASCADE,
          github_token TEXT NOT NULL,
          selected_repos TEXT NOT NULL DEFAULT '[]',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_github_configs_board ON kanban_github_configs(board_id);
      `);
      console.error(
        "[kanban-db] Migration complete: kanban_github_configs table created.",
      );
    }
    // Add selected_projects column if missing
    const columns = db
      .prepare("PRAGMA table_info(kanban_github_configs)")
      .all() as Array<{ name: string }>;
    if (!columns.find((c) => c.name === "selected_projects")) {
      db.exec(
        `ALTER TABLE kanban_github_configs ADD COLUMN selected_projects TEXT NOT NULL DEFAULT '[]'`,
      );
    }
  } catch (err) {
    console.error("[kanban-db] Migration error (non-fatal):", err);
  }
}

try {
  db = initDb();
  migrateAddReadyStatus();
  migrateAddBoardPosition();
  migrateAddGitHubConfigs();
  console.error(`[kanban-db] Connected to opencode.db: ${OPENCODE_DB_PATH}`);
} catch (err) {
  console.error(`[kanban-db] Failed to initialize:`, err);
  process.exit(1);
}

// ── OpenCode session helpers ─────────────────────────────────

export function getSessionFirstUserMessage(sessionId: string): string {
  try {
    const msg = db
      .prepare(
        'SELECT id FROM message WHERE session_id = ? AND data LIKE \'%"role":"user"%\' ORDER BY time_created ASC LIMIT 1',
      )
      .get(sessionId) as { id: string } | undefined;
    if (!msg) return "";
    const part = db
      .prepare(
        'SELECT data FROM part WHERE message_id = ? AND data LIKE \'%"type":"text"%\' ORDER BY time_created ASC LIMIT 1',
      )
      .get(msg.id) as { data: string } | undefined;
    if (!part) return "";
    const parsed = JSON.parse(part.data);
    if (parsed.text) return parsed.text.slice(0, 240);
    return "";
  } catch {
    return "";
  }
}

export function getSessionTokens(sessionId: string): number {
  try {
    const row = db
      .prepare(
        "SELECT data FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'assistant' AND json_extract(data, '$.tokens.total') IS NOT NULL ORDER BY time_created DESC LIMIT 1",
      )
      .get(sessionId) as { data: string } | undefined;
    if (!row) return 0;
    const msg = JSON.parse(row.data);
    return msg.tokens?.total || 0;
  } catch {
    return 0;
  }
}

export function getSessionLatestAgent(sessionId: string): string | null {
  try {
    const row = db
      .prepare(
        "SELECT data FROM message WHERE session_id = ? AND json_extract(data, '$.agent') IS NOT NULL ORDER BY time_created DESC LIMIT 1",
      )
      .get(sessionId) as { data: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.data);
    return parsed.agent || null;
  } catch {
    return null;
  }
}

export function getSessionExplicitColumn(sessionId: string): string | null {
  try {
    const row = db
      .prepare(
        "SELECT column_name FROM kanban_session_columns WHERE session_id = ?",
      )
      .get(sessionId) as { column_name: string } | undefined;
    return row?.column_name || null;
  } catch {
    return null;
  }
}

export function setSessionExplicitColumn(
  sessionId: string,
  columnName: string,
): void {
  db.prepare(
    "INSERT OR REPLACE INTO kanban_session_columns (session_id, column_name, updated_at) VALUES (?, ?, ?)",
  ).run(sessionId, columnName, new Date().toISOString());
}

function determineSessionColumn(
  sessionId: string,
  isCompleted: boolean,
  isArchived: boolean,
): string {
  // 1. Check explicit column assignment (manual moves)
  const explicitColumn = getSessionExplicitColumn(sessionId);
  if (explicitColumn) return explicitColumn;

  // 2. Completed sessions
  if (isCompleted) return "Done";

  // 3. Archived sessions
  if (isArchived) return "Archived";

  // 4. BUILD agent → auto-promote to "In Progress" and persist
  const agent = getSessionLatestAgent(sessionId);
  if (agent) {
    const agentLower = agent.toLowerCase();
    if (agentLower.includes("build") || agentLower.includes("code")) {
      // Persist so it doesn't revert when agent changes
      setSessionExplicitColumn(sessionId, "In Progress");
      return "In Progress";
    }
  }

  // 5. Default: Backlog (new sessions)
  return "Backlog";
}

// ── Board functions ─────────────────────────────────────────

export function getOrCreateBoard(repoPath: string): Board {
  // Resolve symlinks to the real path
  try {
    repoPath = realpathSync(repoPath);
  } catch {
    // path doesn't exist yet, keep as-is
  }

  const existing = db
    .prepare("SELECT * FROM kanban_boards WHERE repo_path = ? AND status = ?")
    .get(repoPath, "active") as Board | undefined;
  if (existing) return existing;

  const name = basename(repoPath);
  const now = new Date().toISOString();

  // Get max position for active boards to insert at the end
  const maxPos = db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 as pos FROM kanban_boards WHERE status = 'active'",
    )
    .get() as { pos: number };

  const board = db
    .prepare(
      "INSERT INTO kanban_boards (name, repo_path, status, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(name, repoPath, "active", maxPos.pos, now, now);

  const boardId = Number(board.lastInsertRowid);
  const defaultColumns = ["Backlog", "In Progress", "Done", "Archived"];
  const insertCol = db.prepare(
    "INSERT OR IGNORE INTO kanban_columns (board_id, name, position) VALUES (?, ?, ?)",
  );
  for (let i = 0; i < defaultColumns.length; i++) {
    insertCol.run(boardId, defaultColumns[i], i);
  }

  emitBoardChange("board_updated", { board_id: boardId });
  return {
    id: boardId,
    name,
    repo_path: repoPath,
    status: "active",
    position: maxPos.pos,
    created_at: now,
    updated_at: now,
  };
}

function ensureColumns(boardId: number): void {
  const required = ["Backlog", "In Progress", "Done", "Archived"];
  const existing = listColumns(boardId).map((c) => c.name);
  const insertCol = db.prepare(
    "INSERT OR IGNORE INTO kanban_columns (board_id, name, position) VALUES (?, ?, ?)",
  );
  for (const name of required) {
    if (!existing.includes(name)) {
      const maxPos = db
        .prepare(
          "SELECT COALESCE(MAX(position), -1) + 1 as pos FROM kanban_columns WHERE board_id = ?",
        )
        .get(boardId) as { pos: number };
      insertCol.run(boardId, name, maxPos.pos);
    }
  }

  // Reorder columns to correct positions: Backlog=0, In Progress=1, Done=2, Archived=3
  const updatePos = db.prepare(
    "UPDATE kanban_columns SET position = ? WHERE board_id = ? AND name = ?",
  );
  for (let i = 0; i < required.length; i++) {
    updatePos.run(i, boardId, required[i]);
  }
}

export function getBoard(boardId: number): Board | null {
  return (
    (db
      .prepare("SELECT * FROM kanban_boards WHERE id = ?")
      .get(boardId) as Board) || null
  );
}

export function listBoards(repoPath?: string): Board[] {
  if (repoPath) {
    return db
      .prepare(
        "SELECT * FROM kanban_boards WHERE repo_path = ? AND status = ? ORDER BY position ASC, updated_at DESC",
      )
      .all(repoPath, "active") as Board[];
  }
  return db
    .prepare(
      "SELECT * FROM kanban_boards WHERE status = ? ORDER BY position ASC, updated_at DESC",
    )
    .all("active") as Board[];
}

export function archiveBoard(boardId: number): void {
  db.prepare(
    "UPDATE kanban_boards SET status = 'archived', updated_at = ? WHERE id = ?",
  ).run(new Date().toISOString(), boardId);
  emitBoardChange("board_updated", { board_id: boardId });
}

export function reorderBoards(boardIds: number[]): void {
  const update = db.prepare(
    "UPDATE kanban_boards SET position = ? WHERE id = ?",
  );
  const transaction = db.transaction(() => {
    for (let i = 0; i < boardIds.length; i++) {
      update.run(i, boardIds[i]);
    }
  });
  transaction();
  emitBoardChange("board_updated", { board_id: 0 });
}

// ── Column functions ────────────────────────────────────────

export function listColumns(boardId: number): Column[] {
  return db
    .prepare(
      "SELECT * FROM kanban_columns WHERE board_id = ? ORDER BY position",
    )
    .all(boardId) as Column[];
}

export function getColumnByName(boardId: number, name: string): Column | null {
  return (
    (db
      .prepare(
        "SELECT * FROM kanban_columns WHERE board_id = ? AND LOWER(name) = LOWER(?)",
      )
      .get(boardId, name) as Column) || null
  );
}

// ── Session move/complete functions ─────────────────────────

export function moveSessionToColumn(
  sessionId: string,
  toColumnName: string,
  boardId: number,
): void {
  // Store explicit column assignment (persists manual moves)
  setSessionExplicitColumn(sessionId, toColumnName);

  // If moving to 'Done': INSERT into kanban_completed
  if (toColumnName === "Done") {
    db.prepare(
      "INSERT OR IGNORE INTO kanban_completed (session_id) VALUES (?)",
    ).run(sessionId);
  } else {
    // If moving away from 'Done': DELETE from kanban_completed
    db.prepare("DELETE FROM kanban_completed WHERE session_id = ?").run(
      sessionId,
    );
  }
  emitBoardChange("card_moved", {
    session_id: sessionId,
    to_column: toColumnName,
  });
}

export function markSessionCompleted(sessionId: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO kanban_completed (session_id) VALUES (?)",
  ).run(sessionId);
  setSessionExplicitColumn(sessionId, "Done");
  emitBoardChange("card_moved", {
    session_id: sessionId,
    to_column: "Done",
  });
}

export function unmarkSessionCompleted(sessionId: string): void {
  db.prepare("DELETE FROM kanban_completed WHERE session_id = ?").run(
    sessionId,
  );
  // Remove explicit column assignment so it gets recomputed from agent
  db.prepare("DELETE FROM kanban_session_columns WHERE session_id = ?").run(
    sessionId,
  );
}

// ── Search function ────────────────────────────────────────

export function searchCards(boardId: number, query: string): Card[] {
  const board = getBoard(boardId);
  if (!board) return [];

  const like = `%${query}%`;
  const sessions = db
    .prepare(
      "SELECT id, directory, title, time_created, time_updated, time_compacting FROM session WHERE parent_id IS NULL AND id NOT IN (SELECT session_id FROM kanban_deleted_sessions) AND (title LIKE ? OR directory LIKE ?) ORDER BY time_updated DESC",
    )
    .all(like, like) as any[];

  const completedSet = new Set(
    (
      db.prepare("SELECT session_id FROM kanban_completed").all() as {
        session_id: string;
      }[]
    ).map((r) => r.session_id),
  );

  const nowMs = Date.now();
  const cards: Card[] = [];

  for (const session of sessions) {
    if (
      session.directory !== board.repo_path &&
      !session.directory.startsWith(board.repo_path + "/")
    )
      continue;

    const isCompacting = !!(
      session.time_compacting && session.time_compacting > 0
    );
    const timeSinceUpdateSec = (nowMs - session.time_updated) / 1000;
    const isArchived = timeSinceUpdateSec >= 86400;
    const isCompleted = completedSet.has(session.id);

    const columnName = determineSessionColumn(
      session.id,
      isCompleted,
      isArchived,
    );

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

export function createSubtask(
  sessionId: string,
  agentName: string,
  agentType: string,
  title: string = "",
  repository: string = "",
  worktree: string = "",
): Subtask {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      "INSERT INTO kanban_subtasks (session_id, agent_name, agent_type, title, repository, worktree, status, progress, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)",
    )
    .run(
      sessionId,
      agentName,
      agentType,
      title,
      repository,
      worktree,
      now,
      now,
    );

  const subtaskId = Number(result.lastInsertRowid);
  const subtask: Subtask = {
    id: subtaskId,
    session_id: sessionId,
    agent_name: agentName,
    agent_type: agentType as Subtask["agent_type"],
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

export function updateSubtask(
  subtaskId: number,
  data: {
    status?: string;
    progress?: number;
    details?: string;
    result_summary?: string;
  },
): Subtask | null {
  const subtask = db
    .prepare("SELECT * FROM kanban_subtasks WHERE id = ?")
    .get(subtaskId) as Subtask | undefined;
  if (!subtask) return null;

  const sets: string[] = [];
  const values: any[] = [];

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

  if (sets.length === 0) return subtask;

  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(subtaskId);

  db.prepare(`UPDATE kanban_subtasks SET ${sets.join(", ")} WHERE id = ?`).run(
    ...values,
  );

  emitBoardChange("subtask_updated", {
    session_id: subtask.session_id,
    status: data.status || subtask.status,
    progress: data.progress ?? subtask.progress,
  });

  return (
    (db.prepare("SELECT * FROM kanban_subtasks WHERE id = ?").get(subtaskId) as
      | Subtask
      | undefined) || null
  );
}

export function getSubtasks(sessionId: string): Subtask[] {
  return db
    .prepare(
      "SELECT * FROM kanban_subtasks WHERE session_id = ? ORDER BY repository, worktree, created_at",
    )
    .all(sessionId) as Subtask[];
}

export function deleteSubtask(subtaskId: number): void {
  db.prepare("DELETE FROM kanban_subtasks WHERE id = ?").run(subtaskId);
}

// ── Agent log functions ─────────────────────────────────────

export function addAgentLog(
  sessionId: string,
  agentName: string,
  agentType: string,
  action: string,
  details: string = "",
  subtaskId?: number,
): AgentLog {
  const result = db
    .prepare(
      "INSERT INTO kanban_agent_logs (session_id, subtask_id, agent_name, agent_type, action, details, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      sessionId,
      subtaskId ?? null,
      agentName,
      agentType,
      action,
      details,
      new Date().toISOString(),
    );

  const log: AgentLog = {
    id: Number(result.lastInsertRowid),
    session_id: sessionId,
    subtask_id: subtaskId ?? null,
    agent_name: agentName,
    agent_type: agentType as AgentLog["agent_type"],
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

export function getAgentLogs(sessionId: string): AgentLog[] {
  return db
    .prepare(
      "SELECT * FROM kanban_agent_logs WHERE session_id = ? ORDER BY timestamp",
    )
    .all(sessionId) as AgentLog[];
}

// ── Full board retrieval ────────────────────────────────────

export function getBoardFull(boardId: number): BoardFull {
  const board = getBoard(boardId);
  if (!board) throw new Error(`Board ${boardId} not found`);

  // Ensure all required columns exist
  ensureColumns(boardId);

  const columns = listColumns(boardId);

  // Get completed sessions
  const completedSet = new Set(
    (
      db.prepare("SELECT session_id FROM kanban_completed").all() as {
        session_id: string;
      }[]
    ).map((r) => r.session_id),
  );

  // Get matching sessions (parent only, matching directory or subdirectory)
  const sessions = db
    .prepare(
      "SELECT id, directory, title, time_created, time_updated, time_compacting FROM session WHERE parent_id IS NULL AND id NOT IN (SELECT session_id FROM kanban_deleted_sessions) ORDER BY time_updated DESC",
    )
    .all() as any[];

  const nowMs = Date.now();
  const cards: Card[] = [];

  for (const session of sessions) {
    if (
      session.directory !== board.repo_path &&
      !session.directory.startsWith(board.repo_path + "/")
    )
      continue;

    const isCompacting = !!(
      session.time_compacting && session.time_compacting > 0
    );
    const timeSinceUpdateSec = (nowMs - session.time_updated) / 1000;
    const isArchived = timeSinceUpdateSec >= 86400;
    const isCompleted = completedSet.has(session.id);

    // Determine column — agent-based (PLAN→Backlog, BUILD→In Progress)
    const columnName = determineSessionColumn(
      session.id,
      isCompleted,
      isArchived,
    );

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

// ── Session messages functions ──────────────────────────────────────────────

interface MessagePart {
  type:
    | "text"
    | "tool"
    | "step-start"
    | "step-finish"
    | "reasoning"
    | "patch"
    | "compaction"
    | "file"
    | "agent";
  text?: string;
  tool?: string;
  callID?: string;
  status?: string;
  input?: unknown;
  output?: unknown;
  auto?: boolean;
  tail_start_id?: string;
  state?: {
    status?: string;
    input?: unknown;
    output?: unknown;
    metadata?: { output?: string; description?: string };
  };
}

interface ToolCall {
  tool: string;
  callID: string;
  status?: string;
  input?: unknown;
  output?: unknown;
}

interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "system";
  model: string | null;
  agent: string | null;
  time_created: number;
  text: string;
  reasoning: string;
  tool_calls: ToolCall[];
  compactions: Array<{ auto: boolean; tail_start_id: string }>;
}

export interface SessionMessagesResponse {
  session_id: string;
  title: string | null;
  directory: string | null;
  model: string | null;
  total: number;
  context_tokens: number;
  messages: SessionMessage[];
}

export function getSessionMessages(
  sessionId: string,
  limit: number = 50,
  offset: number = 0,
): SessionMessagesResponse {
  // Get session directory
  const sessionRow = db
    .prepare("SELECT directory, title FROM session WHERE id = ?")
    .get(sessionId) as { directory: string; title: string } | undefined;
  const sessionDirectory = sessionRow?.directory || null;
  const sessionTitle = sessionRow?.title || null;

  // Get total count
  const { total } = db
    .prepare("SELECT COUNT(*) as total FROM message WHERE session_id = ?")
    .get(sessionId) as { total: number };

  // Get paginated messages
  const messageRows = db
    .prepare(
      "SELECT id, time_created, time_updated, data as msg_data FROM message WHERE session_id = ? ORDER BY time_created ASC LIMIT ? OFFSET ?",
    )
    .all(sessionId, limit, offset) as Array<{
    id: string;
    time_created: number;
    time_updated: number;
    msg_data: string;
  }>;

  const messages: SessionMessage[] = [];
  let sessionModel: string | null = null;

  for (const messageRow of messageRows) {
    let msgData: any;
    try {
      msgData = JSON.parse(messageRow.msg_data);
    } catch {
      console.error(
        `[kanban-db] Skipping malformed message ${messageRow.id}: JSON parse failed`,
      );
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
      .prepare(
        "SELECT data FROM part WHERE message_id = ? ORDER BY time_created ASC",
      )
      .all(messageRow.id) as Array<{ data: string }>;

    let textContent = "";
    let reasoningContent = "";
    const toolCalls: ToolCall[] = [];
    const compactions: Array<{ auto: boolean; tail_start_id: string }> = [];

    for (const partRow of partRows) {
      let partData: MessagePart;
      try {
        partData = JSON.parse(partRow.data) as MessagePart;
      } catch {
        console.error(
          `[kanban-db] Skipping malformed part in message ${messageRow.id}: JSON parse failed`,
        );
        continue;
      }

      if (partData.type === "text" && partData.text) {
        textContent += partData.text;
      } else if (partData.type === "reasoning" && partData.text) {
        reasoningContent += partData.text;
      } else if (partData.type === "tool") {
        const state = partData.state || {};
        toolCalls.push({
          tool: partData.tool || "",
          callID: partData.callID || "",
          status: state.status,
          input: state.input,
          output:
            typeof state.output === "string"
              ? state.output
              : state.metadata?.output || "",
        });
      } else if (partData.type === "compaction") {
        compactions.push({
          auto: partData.auto ?? false,
          tail_start_id: partData.tail_start_id || "",
        });
      }
    }

    // Strip <mandatory>...</mandatory> blocks to prevent them from flashing in chat UI
    textContent = textContent.replace(
      /<mandatory>[\s\S]*?<\/mandatory>\s*/g,
      "",
    ).trim();

    messages.push({
      id: messageRow.id,
      role: role as "user" | "assistant" | "system",
      model,
      agent,
      time_created: messageRow.time_created,
      text: textContent,
      reasoning: reasoningContent,
      tool_calls: toolCalls,
      compactions,
    });
  }

  // Fallback: if sessionModel is still null (pagination missed the first user message),
  // query the DB directly for the first user message with a model field.
  if (!sessionModel) {
    const firstModelRow = db
      .prepare(
        "SELECT data FROM message WHERE session_id = ? " +
          "AND json_extract(data, '$.role') = 'user' " +
          "AND json_extract(data, '$.model') IS NOT NULL " +
          "ORDER BY time_created ASC LIMIT 1",
      )
      .get(sessionId) as { data: string } | undefined;
    if (firstModelRow) {
      const firstModelData = JSON.parse(firstModelRow.data);
      sessionModel = firstModelData.model || null;
    }
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

export function listRules(): Rule[] {
  return db
    .prepare("SELECT * FROM kanban_rules ORDER BY position ASC, created_at ASC")
    .all() as Rule[];
}

export function createRule(
  title: string = "",
  content: string = "",
  enabled: boolean = true,
): Rule {
  const maxPos = db
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 as pos FROM kanban_rules")
    .get() as { pos: number };
  const now = new Date().toISOString();
  const result = db
    .prepare(
      "INSERT INTO kanban_rules (title, content, position, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
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

export function updateRule(
  ruleId: number,
  data: {
    title?: string;
    content?: string;
    enabled?: boolean;
    position?: number;
  },
): Rule | null {
  const rule = db
    .prepare("SELECT * FROM kanban_rules WHERE id = ?")
    .get(ruleId) as Rule | undefined;
  if (!rule) return null;

  const sets: string[] = [];
  const values: any[] = [];

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

  if (sets.length === 0) return rule;

  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(ruleId);

  db.prepare(`UPDATE kanban_rules SET ${sets.join(", ")} WHERE id = ?`).run(
    ...values,
  );

  return (
    (db.prepare("SELECT * FROM kanban_rules WHERE id = ?").get(ruleId) as
      | Rule
      | undefined) || null
  );
}

export function deleteRule(ruleId: number): boolean {
  const result = db
    .prepare("DELETE FROM kanban_rules WHERE id = ?")
    .run(ruleId);
  return result.changes > 0;
}

export function getEnabledRulesContent(): string {
  const rules = db
    .prepare(
      "SELECT content FROM kanban_rules WHERE enabled = 1 ORDER BY position ASC",
    )
    .all() as { content: string }[];
  return rules.map((r) => r.content).join("\n\n");
}

// ── Settings functions ──────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = db
    .prepare("SELECT value FROM kanban_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT OR REPLACE INTO kanban_settings (key, value, updated_at) VALUES (?, ?, ?)",
  ).run(key, value, new Date().toISOString());
}

export function getAllSettings(): Setting[] {
  return db
    .prepare("SELECT * FROM kanban_settings ORDER BY key")
    .all() as Setting[];
}

// ── Session model helper ──────────────────────────────────────────

export function getSessionModel(sessionId: string): string | null {
  try {
    const row = db
      .prepare(
        "SELECT data FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'user' AND json_extract(data, '$.model') IS NOT NULL ORDER BY time_created ASC LIMIT 1",
      )
      .get(sessionId) as { data: string } | undefined;
    if (!row) return null;
    const msg = JSON.parse(row.data);
    return msg.model || null;
  } catch {
    return null;
  }
}

export function setSessionCompacting(
  sessionId: string,
  compacting: boolean,
): void {
  const value = compacting ? Date.now() : null;
  db.prepare("UPDATE session SET time_compacting = ? WHERE id = ?").run(
    value,
    sessionId,
  );
}

export function isSessionCompacting(sessionId: string): boolean {
  const row = db
    .prepare("SELECT time_compacting FROM session WHERE id = ?")
    .get(sessionId) as { time_compacting: number | null } | undefined;
  return !!(row && row.time_compacting && row.time_compacting > 0);
}

// ── Utility ────────────────────────────────────────────────

export function getDistinctRepos(): string[] {
  const rows = db
    .prepare(
      "SELECT DISTINCT repo_path FROM kanban_boards WHERE status = ? ORDER BY repo_path",
    )
    .all("active") as { repo_path: string }[];
  return rows.map((r) => r.repo_path);
}

export function deleteSession(sessionId: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO kanban_deleted_sessions (session_id) VALUES (?)",
  ).run(sessionId);
  db.prepare("DELETE FROM kanban_completed WHERE session_id = ?").run(
    sessionId,
  );
  db.prepare("DELETE FROM kanban_session_columns WHERE session_id = ?").run(
    sessionId,
  );
  db.prepare("DELETE FROM kanban_subtasks WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM kanban_agent_logs WHERE session_id = ?").run(
    sessionId,
  );
  emitBoardChange("card_deleted", { session_id: sessionId });
}

// ── Epic functions ─────────────────────────────────────────

export function deriveTaskKeyPrefix(boardName: string): string {
  const parts = boardName
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter(Boolean);

  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return parts
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .substring(0, 3);
}

export function getNextTaskKey(boardId: number): string {
  const board = getBoard(boardId);
  if (!board) throw new Error(`Board ${boardId} not found`);

  const prefix = deriveTaskKeyPrefix(board.name);

  // Atomic increment: INSERT if not exists, then UPDATE
  db.prepare(
    "INSERT OR IGNORE INTO kanban_task_key_counters (board_id, next_number) VALUES (?, 1)",
  ).run(boardId);

  const row = db
    .prepare(
      "SELECT next_number FROM kanban_task_key_counters WHERE board_id = ?",
    )
    .get(boardId) as { next_number: number } | undefined;

  const num = row?.next_number || 1;

  db.prepare(
    "UPDATE kanban_task_key_counters SET next_number = ? WHERE board_id = ?",
  ).run(num + 1, boardId);

  return `${prefix}-${num}`;
}

export function createEpic(
  boardId: number,
  title: string,
  description: string,
  plannerSessionId: string | null,
): Epic {
  const taskKey = getNextTaskKey(boardId);
  const now = new Date().toISOString();
  const result = db
    .prepare(
      "INSERT INTO kanban_epics (board_id, task_key, title, description, status, planner_session_id, column_name, created_at, updated_at) VALUES (?, ?, ?, ?, 'planning', ?, 'Backlog', ?, ?)",
    )
    .run(boardId, taskKey, title, description, plannerSessionId, now, now);

  const epicId = Number(result.lastInsertRowid);
  const epic: Epic = {
    id: epicId,
    board_id: boardId,
    task_key: taskKey,
    title,
    description,
    plan_text: "",
    status: "planning",
    planner_session_id: plannerSessionId,
    column_name: "Backlog",
    created_at: now,
    updated_at: now,
  };

  emitBoardChange("epic_updated" as any, {
    epic_id: epicId,
    board_id: boardId,
    status: "planning",
  });
  return epic;
}

export function updateEpic(
  epicId: number,
  data: {
    status?: string;
    plan_text?: string;
    column_name?: string;
    title?: string;
    description?: string;
    planner_session_id?: string | null;
  },
): Epic | null {
  const epic = db
    .prepare("SELECT * FROM kanban_epics WHERE id = ?")
    .get(epicId) as Epic | undefined;
  if (!epic) return null;

  const sets: string[] = [];
  const values: any[] = [];

  if (data.status !== undefined) {
    sets.push("status = ?");
    values.push(data.status);
  }
  if (data.plan_text !== undefined) {
    sets.push("plan_text = ?");
    values.push(data.plan_text);
  }
  if (data.column_name !== undefined) {
    sets.push("column_name = ?");
    values.push(data.column_name);
  }
  if (data.title !== undefined) {
    sets.push("title = ?");
    values.push(data.title);
  }
  if (data.description !== undefined) {
    sets.push("description = ?");
    values.push(data.description);
  }
  if (data.planner_session_id !== undefined) {
    sets.push("planner_session_id = ?");
    values.push(data.planner_session_id);
  }

  if (sets.length === 0) return epic;

  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(epicId);

  db.prepare(`UPDATE kanban_epics SET ${sets.join(", ")} WHERE id = ?`).run(
    ...values,
  );

  const updated =
    (db.prepare("SELECT * FROM kanban_epics WHERE id = ?").get(epicId) as
      | Epic
      | undefined) || null;
  if (updated) {
    emitBoardChange("epic_updated" as any, {
      epic_id: updated.id,
      board_id: updated.board_id,
      status: updated.status,
    });
  }
  return updated;
}

export function getEpic(epicId: number): Epic | null {
  return (
    (db.prepare("SELECT * FROM kanban_epics WHERE id = ?").get(epicId) as
      | Epic
      | undefined) || null
  );
}

export function getEpicsByBoard(boardId: number): Epic[] {
  return db
    .prepare(
      "SELECT * FROM kanban_epics WHERE board_id = ? ORDER BY created_at ASC",
    )
    .all(boardId) as Epic[];
}

export function deleteEpic(epicId: number): void {
  const epic = getEpic(epicId);
  if (!epic) return;

  // Get child session IDs before deleting
  const sessions = getEpicSessions(epicId);
  const childSessionIds = sessions.map((s) => s.session_id);

  // Delete epic sessions first (FK cascade should handle this, but be explicit)
  db.prepare("DELETE FROM kanban_epic_sessions WHERE epic_id = ?").run(epicId);
  // Delete the epic
  db.prepare("DELETE FROM kanban_epics WHERE id = ?").run(epicId);

  // Clean up kanban tracking for child sessions
  for (const sid of childSessionIds) {
    db.prepare(
      "INSERT OR IGNORE INTO kanban_deleted_sessions (session_id) VALUES (?)",
    ).run(sid);
    db.prepare("DELETE FROM kanban_completed WHERE session_id = ?").run(sid);
    db.prepare("DELETE FROM kanban_session_columns WHERE session_id = ?").run(
      sid,
    );
  }

  // Also clean up planner session
  if (epic.planner_session_id) {
    db.prepare(
      "INSERT OR IGNORE INTO kanban_deleted_sessions (session_id) VALUES (?)",
    ).run(epic.planner_session_id);
    db.prepare("DELETE FROM kanban_completed WHERE session_id = ?").run(
      epic.planner_session_id,
    );
    db.prepare("DELETE FROM kanban_session_columns WHERE session_id = ?").run(
      epic.planner_session_id,
    );
  }

  emitBoardChange("epic_updated" as any, {
    epic_id: epicId,
    board_id: epic.board_id,
    status: "deleted",
  });
}

export function addEpicSession(
  epicId: number,
  sessionId: string,
  taskKey: string,
  subtaskIndex: number,
  title: string,
  description: string,
): EpicSession {
  const result = db
    .prepare(
      "INSERT INTO kanban_epic_sessions (epic_id, session_id, task_key, subtask_index, title, description) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(epicId, sessionId, taskKey, subtaskIndex, title, description);

  const epicSessionId = Number(result.lastInsertRowid);
  const epicSession: EpicSession = {
    id: epicSessionId,
    epic_id: epicId,
    session_id: sessionId,
    task_key: taskKey,
    subtask_index: subtaskIndex,
    title,
    description,
  };

  const epic = getEpic(epicId);
  if (epic) {
    emitBoardChange("epic_updated" as any, {
      epic_id: epicId,
      board_id: epic.board_id,
      status: epic.status,
    });
  }
  return epicSession;
}

export function getEpicSessions(epicId: number): EpicSession[] {
  return db
    .prepare(
      "SELECT * FROM kanban_epic_sessions WHERE epic_id = ? ORDER BY subtask_index ASC",
    )
    .all(epicId) as EpicSession[];
}

export function getEpicForSession(sessionId: string): Epic | null {
  const row = db
    .prepare("SELECT epic_id FROM kanban_epic_sessions WHERE session_id = ?")
    .get(sessionId) as { epic_id: number } | undefined;
  if (!row) return null;
  return getEpic(row.epic_id);
}

export function updateEpicStatus(epicId: number): void {
  const epic = getEpic(epicId);
  if (!epic) return;

  const sessions = getEpicSessions(epicId);
  if (sessions.length === 0) return;

  // Get completed set to check if child sessions are done
  const completedSet = new Set(
    (
      db.prepare("SELECT session_id FROM kanban_completed").all() as {
        session_id: string;
      }[]
    ).map((r) => r.session_id),
  );

  const allCompleted = sessions.every((s) => completedSet.has(s.session_id));
  const anyFailed = sessions.some((s) => {
    // Check if session is in a failed state — we consider it failed if it was deleted or if status indicates failure
    // For now, we check if it's completed (not failed). Real failure detection would need opencode status.
    return false; // Will be enhanced with opencode status checks
  });

  let newStatus: string = epic.status;
  let newColumn: string = epic.column_name;

  if (allCompleted) {
    newStatus = "completed";
    newColumn = "Done";
  }

  if (newStatus !== epic.status || newColumn !== epic.column_name) {
    updateEpic(epicId, { status: newStatus, column_name: newColumn });
  }
}

// ── Memory settings helpers ──────────────────────────────────

export function isMemoriesEnabled(): boolean {
  const val = getSetting("memories_enabled");
  if (val === null) return true; // default: enabled
  return val === "true" || val === "1";
}

export function getAutoPruneDays(): number {
  const val = getSetting("memories_auto_prune_days");
  if (val === null) return 90; // default: 90 days
  const num = parseInt(val, 10);
  return isNaN(num) ? 90 : Math.max(1, Math.min(365, num));
}

export function isKeepImportant(): boolean {
  const val = getSetting("memories_keep_important");
  if (val === null) return true; // default: keep important
  return val === "true" || val === "1";
}

export function closeDb(): void {
  db.close();
}

// ── GitHub config helpers ──────────────────────────────────────

export interface GitHubConfigRow {
  board_id: number;
  github_token: string;
  selected_repos: string; // JSON array string
  selected_projects: string; // JSON array string of project IDs
  created_at: string;
  updated_at: string;
}

export function getGitHubConfig(boardId: number): GitHubConfigRow | undefined {
  return db
    .prepare("SELECT * FROM kanban_github_configs WHERE board_id = ?")
    .get(boardId) as GitHubConfigRow | undefined;
}

export function saveGitHubConfig(
  boardId: number,
  token: string,
  selectedRepos: string[],
): void {
  const reposJson = JSON.stringify(selectedRepos);
  db.prepare(
    `
    INSERT INTO kanban_github_configs (board_id, github_token, selected_repos)
    VALUES (?, ?, ?)
    ON CONFLICT(board_id) DO UPDATE SET
      github_token = excluded.github_token,
      updated_at = datetime('now')
  `,
  ).run(boardId, token, reposJson);
}

export function updateGitHubSelectedRepos(
  boardId: number,
  selectedRepos: string[],
): void {
  const reposJson = JSON.stringify(selectedRepos);
  db.prepare(
    `
    UPDATE kanban_github_configs
    SET selected_repos = ?, updated_at = datetime('now')
    WHERE board_id = ?
  `,
  ).run(reposJson, boardId);
}

export function updateGitHubSelectedProjects(
  boardId: number,
  selectedProjects: string[],
): void {
  const projectsJson = JSON.stringify(selectedProjects);
  db.prepare(
    `
    UPDATE kanban_github_configs
    SET selected_projects = ?, updated_at = datetime('now')
    WHERE board_id = ?
  `,
  ).run(projectsJson, boardId);
}

export function deleteGitHubConfig(boardId: number): void {
  db.prepare("DELETE FROM kanban_github_configs WHERE board_id = ?").run(
    boardId,
  );
}

// ── Linear config helpers ──────────────────────────────────────

export interface LinearConfigRow {
  board_id: number;
  linear_api_key: string;
  selected_teams: string; // JSON array string
  created_at: string;
  updated_at: string;
}

export function getLinearConfig(boardId: number): LinearConfigRow | undefined {
  return db
    .prepare("SELECT * FROM kanban_linear_configs WHERE board_id = ?")
    .get(boardId) as LinearConfigRow | undefined;
}

export function saveLinearConfig(
  boardId: number,
  apiKey: string,
): void {
  const teamsJson = JSON.stringify([]);
  db.prepare(
    `
    INSERT INTO kanban_linear_configs (board_id, linear_api_key, selected_teams)
    VALUES (?, ?, ?)
    ON CONFLICT(board_id) DO UPDATE SET
      linear_api_key = excluded.linear_api_key,
      updated_at = datetime('now')
  `,
  ).run(boardId, apiKey, teamsJson);
}

export function updateLinearSelectedTeams(
  boardId: number,
  selectedTeams: string[],
): void {
  const teamsJson = JSON.stringify(selectedTeams);
  db.prepare(
    `
    UPDATE kanban_linear_configs
    SET selected_teams = ?, updated_at = datetime('now')
    WHERE board_id = ?
  `,
  ).run(teamsJson, boardId);
}

export function deleteLinearConfig(boardId: number): void {
  db.prepare("DELETE FROM kanban_linear_configs WHERE board_id = ?").run(
    boardId,
  );
}
