#!/usr/bin/env node

import express, { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import os from "os";
import fs from "fs";
import { createServer, request as httpRequest } from "http";
import { setupTerminalServer } from "./terminal.js";
import { exec, execFile } from "child_process";

// ── Proxy to opencode's embedded HTTP server ──────────────
const OPENCODE_SERVER = process.env.OPENCODE_SERVER_URL || "http://127.0.0.1:4096";

function getSessionDirectory(sessionId: string): string | null {
  try {
    const row = getDb()
      .prepare("SELECT directory FROM session WHERE id = ?")
      .get(sessionId) as { directory: string } | undefined;
    return row?.directory || null;
  } catch {
    return null;
  }
}

async function proxyToOpencode(req: Request, res: Response) {
  try {
    const originalPath = req.originalUrl.replace("/api/opencode", "");
    const proxyUrl = new URL(`${OPENCODE_SERVER}${originalPath}`);
    
    // Inject session directory for session-scoped routes if not already present
    const sessionMatch = originalPath.match(/^\/session\/([^/]+)\/(.+)/);
    if (sessionMatch && !proxyUrl.searchParams.has("directory")) {
      const sessionDir = getSessionDirectory(sessionMatch[1]);
      if (sessionDir) proxyUrl.searchParams.set("directory", sessionDir);
    }
    
    const url = proxyUrl.toString();
    const headers: Record<string, string> = {};
    if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"] as string;
    const body = req.body && Object.keys(req.body).length > 0 ? JSON.stringify(req.body) : undefined;
    const opencodeRes = await fetch(url, {
      method: req.method,
      headers,
      body,
    });
    res.status(opencodeRes.status).set("Content-Type", opencodeRes.headers.get("content-type") || "application/json");
    const text = await opencodeRes.text();
    res.send(text);
  } catch (err) {
    res.status(502).json({ error: `opencode server unreachable: ${(err as Error).message}` });
  }
}
import { bus, EVENT_TYPES, type KanbanEvents, emitBoardChange } from "./event-bus.js";
import {
  listBoards,
  getBoardFull,
  getOrCreateBoard,
  archiveBoard,
  moveSessionToColumn,
  searchCards,
  getSubtasks,
  createSubtask,
  updateSubtask,
  deleteSubtask,
  addAgentLog,
  getAgentLogs,
  getDistinctRepos,
  markSessionCompleted,
  unmarkSessionCompleted,
  getSessionMessages,
  getEnabledRulesContent,
  listRules,
  createRule,
  updateRule,
  deleteRule,
  getDb,
  getAllSettings,
  getSetting,
  setSetting,
  getAutoCompactThreshold,
  isAutoCompactEnabled,
  getSessionTokens,
  getSessionModel,
  getActiveSessionIds,
  deleteSession,
} from "./db.js";

// ── Setup ────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.WEB_PORT || "3210", 10);
const app = express();

// ── Middleware ───────────────────────────────────────────────

app.use(express.json());

// ── Proxy to opencode embedded server ─────────────────────
app.all("/api/opencode/*", proxyToOpencode);

// ── Agent File Management ────────────────────────────────

// GET /api/agents/:name/file - Read agent markdown file
app.get("/api/agents/:name/file", (req: Request, res: Response) => {
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
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        res.json({ name, content: "", path: filePath, exists: false });
      } else {
        throw err;
      }
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/agents/:name/file - Write agent markdown file
app.put("/api/agents/:name/file", (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { content } = req.body as { content?: string };

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
      res.json({ success: true, name });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Create new session via opencode ──────────────────────
app.post("/api/sessions", async (req: Request, res: Response) => {
  try {
    const { directory, board_id } = req.body as { directory?: string; board_id?: number };
    const url = new URL(`${OPENCODE_SERVER}/session`);
    if (directory) url.searchParams.set("directory", directory);
    const opencodeRes = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!opencodeRes.ok) {
      const body = await opencodeRes.text().catch(() => "");
      res.status(opencodeRes.status).json({ error: body || `opencode error ${opencodeRes.status}` });
      return;
    }
    const session = await opencodeRes.json();
    // Update session directory to match the requested directory
    if (directory) {
      try {
        const db = getDb();
        db.prepare("UPDATE session SET directory = ?, path = ? WHERE id = ?")
          .run(directory, directory.replace(/^\//, ""), session.id);
      } catch {
        // non-critical: session created but directory may not match board
      }
    }
    // Emit SSE event so the board refreshes and shows the new card
    if (board_id) {
      emitBoardChange("card_created", { session_id: session.id, board_id });
    } else if (directory) {
      // Fallback: look up board from directory
      try {
        const board = getDb()
          .prepare("SELECT id FROM kanban_boards WHERE repo_path = ? AND status = 'active'")
          .get(directory) as { id: number } | undefined;
        if (board) {
          emitBoardChange("card_created", { session_id: session.id, board_id: board.id });
        }
      } catch {
        // non-critical
      }
    }
    // Return updated session with corrected directory
    res.json({ ...session, directory: directory || session.directory, path: directory ? directory.replace(/^\//, "") : session.path });
  } catch (err) {
    res.status(502).json({ error: `opencode server unreachable: ${(err as Error).message}` });
  }
});

// ── Send message via opencode serve HTTP API ──────────────
app.post("/api/sessions/:sessionId/send", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { text, agent } = req.body as { text?: string; agent?: string };
    if (!text?.trim()) {
      res.status(400).json({ error: "Message text is required" });
      return;
    }

    // Build parts array — inject mandatory rules
    const parts: object[] = [];
    const rulesContent = getEnabledRulesContent();
    if (rulesContent.trim()) {
      parts.push({ type: "text", text: `<mandatory>\n${rulesContent.trim()}\n</mandatory>` });
    }
    parts.push({ type: "text", text: text.trim() });

    const sessionDir = getSessionDirectory(sessionId);
    const messageUrl = new URL(`${OPENCODE_SERVER}/session/${sessionId}/prompt_async`);
    if (sessionDir) messageUrl.searchParams.set("directory", sessionDir);
    const url = messageUrl.toString();
    const opencodeRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parts, ...(agent ? { agent } : {}) }),
    });

    if (!opencodeRes.ok) {
      const body = await opencodeRes.text().catch(() => "");
      res.status(opencodeRes.status).json({ error: body || `opencode error ${opencodeRes.status}` });
      return;
    }

    // prompt_async returns 204 — respond immediately
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: `opencode server unreachable: ${(err as Error).message}` });
  }
});

// ── Question tool proxy (opencode question API) ──────────────────────

// GET pending questions
app.get("/api/opencode/question", async (req: Request, res: Response) => {
  try {
    const url = new URL(`${OPENCODE_SERVER}/question`);
    const dir = req.query.directory as string | undefined;
    if (dir) url.searchParams.set("directory", dir);
    const opencodeRes = await fetch(url.toString());
    if (!opencodeRes.ok) {
      const body = await opencodeRes.text().catch(() => "");
      res.status(opencodeRes.status).json({ error: body || `opencode error ${opencodeRes.status}` });
      return;
    }
    const data = await opencodeRes.json();
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: `opencode server unreachable: ${(err as Error).message}` });
  }
});

// POST reply to a question
app.post("/api/opencode/question/:questionId/reply", async (req: Request, res: Response) => {
  try {
    const { questionId } = req.params;
    const url = new URL(`${OPENCODE_SERVER}/question/${questionId}/reply`);
    const dir = req.query.directory as string | undefined;
    if (dir) url.searchParams.set("directory", dir);
    const opencodeRes = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    if (!opencodeRes.ok) {
      const body = await opencodeRes.text().catch(() => "");
      res.status(opencodeRes.status).json({ error: body || `opencode error ${opencodeRes.status}` });
      return;
    }
    const data = await opencodeRes.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: `opencode server unreachable: ${(err as Error).message}` });
  }
});

// POST reject a question
app.post("/api/opencode/question/:questionId/reject", async (req: Request, res: Response) => {
  try {
    const { questionId } = req.params;
    const url = new URL(`${OPENCODE_SERVER}/question/${questionId}/reject`);
    const dir = req.query.directory as string | undefined;
    if (dir) url.searchParams.set("directory", dir);
    const opencodeRes = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!opencodeRes.ok) {
      const body = await opencodeRes.text().catch(() => "");
      res.status(opencodeRes.status).json({ error: body || `opencode error ${opencodeRes.status}` });
      return;
    }
    const data = await opencodeRes.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: `opencode server unreachable: ${(err as Error).message}` });
  }
});

// ── Project Summary ────────────────────────────────────────
app.post("/api/project-summary", async (req: Request, res: Response) => {
  try {
    const { directory } = req.body as { directory?: string };
    if (!directory) {
      res.status(400).json({ error: "directory is required" });
      return;
    }

    // 1. Create session directly via opencode (bypasses kanban card creation)
    const sessionUrl = new URL(`${OPENCODE_SERVER}/session`);
    sessionUrl.searchParams.set("directory", directory);
    const sessionRes = await fetch(sessionUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!sessionRes.ok) {
      const body = await sessionRes.text().catch(() => "");
      res.status(sessionRes.status).json({ error: body || `opencode error ${sessionRes.status}` });
      return;
    }
    const session = await sessionRes.json();

    // 2. Update session directory in kanban DB so getSessionMessages works
    try {
      const db = getDb();
      db.prepare("UPDATE session SET directory = ?, path = ? WHERE id = ?")
        .run(directory, directory.replace(/^\//, ""), session.id);
    } catch {
      // non-critical
    }

    // 3. Send the summary prompt via prompt_async (non-blocking)
    const promptUrl = new URL(`${OPENCODE_SERVER}/session/${session.id}/prompt_async`);
    promptUrl.searchParams.set("directory", directory);
    const promptRes = await fetch(promptUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parts: [
          {
            type: "text",
            text: "Provide a concise project summary for this codebase. Include: purpose, tech stack, architecture, key modules, and current state. Be thorough but concise. Use markdown formatting.",
          },
        ],
      }),
    });
    if (!promptRes.ok) {
      const body = await promptRes.text().catch(() => "");
      res.status(promptRes.status).json({ error: body || `opencode prompt error ${promptRes.status}` });
      return;
    }

    // 4. Return session ID — frontend will poll messages
    res.json({ session_id: session.id });
  } catch (err) {
    res.status(502).json({ error: `opencode server unreachable: ${(err as Error).message}` });
  }
});

// ── REST API Routes ─────────────────────────────────────────

// Boards
app.get("/api/boards", (req: Request, res: Response) => {
  try {
    const repoPath = req.query.repo_path as string | undefined;
    const boards = listBoards(repoPath);
    res.json(boards);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/boards/:id", async (req: Request, res: Response) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    const boardFull = getBoardFull(boardId);

    // Fetch session statuses from opencode to determine is_busy for each card
    // The directory parameter is required — without it the endpoint returns {}
    try {
      const statusUrl = new URL(`${OPENCODE_SERVER}/session/status`);
      if (boardFull.board.repo_path) statusUrl.searchParams.set("directory", boardFull.board.repo_path);
      const statusRes = await fetch(statusUrl.toString());
      if (statusRes.ok) {
        const statuses = await statusRes.json() as Record<string, { type: string }>;
        for (const card of boardFull.cards) {
          card.is_busy = statuses[card.session_id]?.type === "busy" || statuses[card.session_id]?.type === "retry" || false;
        }
      }
    } catch {
      // Status fetch is non-critical; cards default to is_busy = undefined
    }

    res.json(boardFull);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/boards/get-or-create", (req: Request, res: Response) => {
  try {
    const { repo_path } = req.body;
    if (!repo_path) {
      return res.status(400).json({ error: "repo_path is required" });
    }
    const board = getOrCreateBoard(repo_path);
    res.json(board);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete("/api/boards/:id", (req: Request, res: Response) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    archiveBoard(boardId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// Sessions/Cards
app.patch("/api/sessions/:sessionId/move", (req: Request, res: Response) => {
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
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/sessions/:sessionId/complete", (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    markSessionCompleted(sessionId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post(
  "/api/sessions/:sessionId/uncomplete",
  (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      unmarkSessionCompleted(sessionId);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  },
);

app.delete("/api/sessions/:sessionId", (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    deleteSession(sessionId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.get("/api/cards/search", (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    const boardId = req.query.board_id
      ? parseInt(req.query.board_id as string, 10)
      : undefined;

    if (!query || !boardId) {
      return res
        .status(400)
        .json({ error: "q (query) and board_id are required" });
    }

    const results = searchCards(boardId, query);
    res.json(results);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// Subtasks
app.get("/api/sessions/:sessionId/subtasks", (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const subtasks = getSubtasks(sessionId);
    res.json(subtasks);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/sessions/:sessionId/subtasks", (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { agent_name, agent_type, title, repository, worktree } = req.body;

    if (!agent_name || !agent_type) {
      return res
        .status(400)
        .json({ error: "agent_name and agent_type are required" });
    }

    const subtask = createSubtask(
      sessionId,
      agent_name,
      agent_type,
      title || "",
      repository || "",
      worktree || "",
    );
    res.json(subtask);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.patch("/api/subtasks/:id", (req: Request, res: Response) => {
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
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.delete("/api/subtasks/:id", (req: Request, res: Response) => {
  try {
    const subtaskId = parseInt(req.params.id, 10);
    deleteSubtask(subtaskId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// Agent logs
app.get("/api/sessions/:sessionId/logs", (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const logs = getAgentLogs(sessionId);
    res.json(logs);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/sessions/:sessionId/logs", (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { agent_name, agent_type, action, details, subtask_id } = req.body;

    if (!agent_name || !agent_type || !action) {
      return res
        .status(400)
        .json({ error: "agent_name, agent_type, and action are required" });
    }

    const log = addAgentLog(
      sessionId,
      agent_name,
      agent_type,
      action,
      details || "",
      subtask_id,
    );
    res.json(log);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// Session messages (paginated)
app.get("/api/sessions/:sessionId/messages", (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const messagesData = getSessionMessages(sessionId, limit, offset);
    res.json(messagesData);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// Repos
app.get("/api/repos", (req: Request, res: Response) => {
  try {
    const repos = getDistinctRepos();
    res.json(repos);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Rules ─────────────────────────────────────────────────────

app.get("/api/rules", (req: Request, res: Response) => {
  try {
    const rules = listRules();
    res.json(rules);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/rules", (req: Request, res: Response) => {
  try {
    const { title, content, enabled } = req.body as { title?: string; content?: string; enabled?: boolean };
    const rule = createRule(title || "", content || "", enabled !== false);
    res.json(rule);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.put("/api/rules/:id", (req: Request, res: Response) => {
  try {
    const ruleId = parseInt(req.params.id, 10);
    const { title, content, enabled, position } = req.body as {
      title?: string;
      content?: string;
      enabled?: boolean;
      position?: number;
    };
    const updated = updateRule(ruleId, { title, content, enabled, position });
    if (!updated) {
      return res.status(404).json({ error: "Rule not found" });
    }
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.delete("/api/rules/:id", (req: Request, res: Response) => {
  try {
    const ruleId = parseInt(req.params.id, 10);
    const deleted = deleteRule(ruleId);
    if (!deleted) {
      return res.status(404).json({ error: "Rule not found" });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Server-Sent Events (SSE) ────────────────────────────────

app.get("/api/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const handler = (payload: any) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // Listen to all event types
  const cleanup: (() => void)[] = [];
  for (const eventType of Object.values(EVENT_TYPES)) {
    const typedHandler = (payload: any) =>
      handler({ type: eventType, ...payload });
    bus.on(eventType as KanbanEvents, typedHandler as any);
    cleanup.push(() => bus.off(eventType as KanbanEvents, typedHandler as any));
  }
  // Also relay opencode session status events
  const statusHandler = (payload: any) => {
    handler({ type: "opencode_session_status", ...payload });
  };
  bus.on("opencode_session_status" as any, statusHandler as any);
  cleanup.push(() => bus.off("opencode_session_status" as any, statusHandler as any));

  req.on("close", () => {
    cleanup.forEach((fn) => fn());
  });
});

// Filesystem browsing for workspace picker
app.get("/api/filesystem", (req: Request, res: Response) => {
  try {
    let dirPath = (req.query.path as string) || "/";
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
        if (entry.name.startsWith(".")) return false;
        // Accept directories or symlinks (to directories)
        return entry.isDirectory() || entry.isSymbolicLink();
      })
      .map((entry) => ({
        name: entry.name,
        path: path.join(dirPath, entry.name),
        has_children: false, // we'll check on demand
        is_symlink: entry.isSymbolicLink(),
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    res.json({
      path: dirPath,
      parent: path.dirname(dirPath),
      entries,
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// ── General Settings ────────────────────────────────────────

app.get("/api/settings", (_req: Request, res: Response) => {
  try {
    const settings = getAllSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.put("/api/settings", (req: Request, res: Response) => {
  try {
    const updates = req.body as Record<string, string>;
    if (!updates || typeof updates !== "object") {
      return res.status(400).json({ error: "Object with key/value pairs required" });
    }
    for (const [key, value] of Object.entries(updates)) {
      if (typeof key !== "string" || typeof value !== "string") continue;
      setSetting(key, value);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Backend Reload ──────────────────────────────────────────

app.post("/api/reload", (_req: Request, res: Response) => {
  try {
    const projectRoot = path.join(__dirname, "..");

    res.json({ success: true, message: "Rebuild started. Server will restart shortly." });

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
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Compaction proxy ────────────────────────────────────────

app.post("/api/sessions/:sessionId/compact", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const sessionDir = getSessionDirectory(sessionId);
    const compactUrl = new URL(`${OPENCODE_SERVER}/session/${sessionId}/compact`);
    if (sessionDir) compactUrl.searchParams.set("directory", sessionDir);
    
    const opencodeRes = await fetch(compactUrl.toString(), { method: "POST" });
    if (!opencodeRes.ok) {
      const body = await opencodeRes.text().catch(() => "");
      return res.status(opencodeRes.status).json({ error: body || `opencode error ${opencodeRes.status}` });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ error: `opencode server unreachable: ${(err as Error).message}` });
  }
});

// ── Auto-compact monitor ──────────────────────────────────────

// Cache provider context limits from opencode
let cachedContextLimits: Record<string, number> = {};
let contextLimitsFetchedAt = 0;

async function fetchContextLimits(): Promise<Record<string, number>> {
  const now = Date.now();
  // Cache for 5 minutes
  if (now - contextLimitsFetchedAt < 300000 && Object.keys(cachedContextLimits).length > 0) {
    return cachedContextLimits;
  }
  try {
    const res = await fetch(`${OPENCODE_SERVER}/provider`);
    if (!res.ok) return cachedContextLimits;
    const data = await res.json() as {
      all: Array<{
        id: string;
        models: Record<string, { limit?: { context?: number } }>;
      }>;
      connected?: string[];
    };
    const limits: Record<string, number> = {};
    for (const provider of data.all) {
      if (data.connected && !data.connected.includes(provider.id)) continue;
      for (const [modelId, model] of Object.entries(provider.models)) {
        const ctx = model.limit?.context;
        if (ctx && !limits[modelId]) limits[modelId] = ctx;
      }
    }
    cachedContextLimits = limits;
    contextLimitsFetchedAt = now;
  } catch {
    // opencode server may be temporarily unreachable
  }
  return cachedContextLimits;
}

async function checkAutoCompact(): Promise<void> {
  if (!isAutoCompactEnabled()) return;
  const threshold = getAutoCompactThreshold();
  if (threshold <= 0) return;

  const limits = await fetchContextLimits();
  if (Object.keys(limits).length === 0) return;

  const activeSessions = getActiveSessionIds();

  for (const session of activeSessions) {
    try {
      const tokens = getSessionTokens(session.id);
      if (tokens <= 0) continue;

      const model = getSessionModel(session.id);
      if (!model) continue;

      const limit = limits[model];
      if (!limit || limit <= 0) continue;

      const ratio = tokens / limit;
      if (ratio >= threshold / 100) {
        // Trigger compaction via opencode API
        const compactUrl = new URL(`${OPENCODE_SERVER}/session/${session.id}/compact`);
        if (session.directory) compactUrl.searchParams.set("directory", session.directory);
        await fetch(compactUrl.toString(), { method: "POST" }).catch(() => {});
      }
    } catch {
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
function safeParseSSELine(line: string): any | null {
  if (!line.startsWith("data: ")) return null;
  let jsonStr = line.slice(6);
  // Handle double-prefixed data: "data: {"id":"data: {…}"}"
  // If the JSON string starts with { and contains "data: " as a value, try stripping the outer wrapper
  try {
    return JSON.parse(jsonStr);
  } catch {
    // Try to find the inner JSON object if the outer one is malformed
    const innerMatch = jsonStr.match(/"data:\s*(\{.*\})"/s);
    if (innerMatch) {
      try {
        return JSON.parse(innerMatch[1]);
      } catch {
        // Give up
      }
    }
  }
  return null;
}

function subscribeToOpencodeEvents() {
  // We need to subscribe to the SSE stream per-workspace (directory).
  // Subscribe to each active board's workspace and relay all events.
  const connect = (directory: string) => {
    try {
      const url = new URL(`${OPENCODE_SERVER}/event`);
      if (directory) url.searchParams.set("directory", directory);
      const req = httpRequest(url, (upstreamRes) => {
        let buffer = "";
        upstreamRes.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const eventData = JSON.parse(line.slice(6));
                if (eventData.type === "session.status" && eventData.properties?.sessionID) {
                  bus.emit("opencode_session_status" as any, {
                    sessionID: eventData.properties.sessionID,
                    status: eventData.properties.status,
                  } as any);
                }
              } catch {
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
    } catch {
      setTimeout(() => connect(directory), 5000);
    }
  };

  // Connect for each active board's workspace
  try {
    const boards = listBoards();
    for (const board of boards) {
      if (board.repo_path) connect(board.repo_path);
    }
  } catch {
    // retry later
  }
}

subscribeToOpencodeEvents();

// ── Static Files & SPA Fallback ────────────────────────────

const distPath = path.join(__dirname, "..", "dist", "web");
app.use(express.static(distPath));

app.get("*", (req: Request, res: Response) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// ── Start Server ────────────────────────────────────────────

const server = createServer(app);
setupTerminalServer(server);
server.listen(PORT, () => {
  console.log(`Kanban MCP web UI: http://localhost:${PORT}`);
});
