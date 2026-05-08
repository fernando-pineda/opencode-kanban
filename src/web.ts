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
const OPENCODE_SERVER =
  process.env.OPENCODE_SERVER_URL || "http://127.0.0.1:4096";

// ── Hidden agents management ──────────────────────────────
const HIDDEN_AGENTS_PATH = path.join(
  os.homedir(),
  ".config/opencode/agents",
  ".hidden-agents.json",
);

function getHiddenAgents(): string[] {
  try {
    if (fs.existsSync(HIDDEN_AGENTS_PATH)) {
      const data = fs.readFileSync(HIDDEN_AGENTS_PATH, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // ignore
  }
  return [];
}

function setHiddenAgents(names: string[]): void {
  const dir = path.dirname(HIDDEN_AGENTS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(HIDDEN_AGENTS_PATH, JSON.stringify(names, null, 2), "utf-8");
}

function hideAgent(name: string): void {
  const hidden = getHiddenAgents();
  if (!hidden.includes(name)) {
    hidden.push(name);
    setHiddenAgents(hidden);
  }
}

function unhideAgent(name: string): void {
  const hidden = getHiddenAgents().filter((n) => n !== name);
  setHiddenAgents(hidden);
}

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

/**
 * Build the combined mandatory context: rules + memories + knowledge for the session's repo.
 */
function getMandatoryContext(sessionId: string): string {
  const parts: string[] = [];

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
    } catch {
      /* no knowledge table for this repo yet */
    }

    try {
      const memories = getMemories(repoPath, { limit: 20 });
      if (memories.length > 0) {
        const mText = memories
          .map(
            (m) =>
              `[${m.memory_type}] ${m.summary || (m.content || "").slice(0, 120)}`,
          )
          .join("\n");
        parts.push(`## Recent Memories (auto-loaded)\n${mText}`);
      }
    } catch {
      /* no memories table for this repo yet */
    }
  }

  return parts.join("\n\n");
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
    if (req.headers["content-type"])
      headers["content-type"] = req.headers["content-type"] as string;
    const body =
      req.body && Object.keys(req.body).length > 0
        ? JSON.stringify(req.body)
        : undefined;
    const opencodeRes = await fetch(url, {
      method: req.method,
      headers,
      body,
    });
    res
      .status(opencodeRes.status)
      .set(
        "Content-Type",
        opencodeRes.headers.get("content-type") || "application/json",
      );
    const text = await opencodeRes.text();
    res.send(text);
  } catch (err) {
    res.status(502).json({
      error: `opencode server unreachable: ${(err as Error).message}`,
    });
  }
}
import {
  bus,
  EVENT_TYPES,
  type KanbanEvents,
  emitBoardChange,
} from "./event-bus.js";
import {
  listBoards,
  getBoardFull,
  getOrCreateBoard,
  archiveBoard,
  reorderBoards,
  moveSessionToColumn,
  searchCards,
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
  getSessionModel,
  deleteSession,
  setSessionCompacting,
  isSessionCompacting,
  getGitHubConfig,
  saveGitHubConfig,
  updateGitHubSelectedRepos,
  updateGitHubSelectedProjects,
  deleteGitHubConfig,
  getLinearConfig,
  saveLinearConfig,
  updateLinearSelectedTeams,
  deleteLinearConfig,
} from "./db.js";
import {
  validateGitHubToken,
  listGitHubRepos,
  listGitHubIssues,
  getGitHubIssue,
  parseRepoFullName,
  listGitHubProjects,
  listGitHubProjectItems,
} from "./github.js";
import {
  validateLinearToken,
  listLinearTeams,
  listLinearIssues,
  getLinearIssue,
} from "./linear.js";
import {
  searchMemories,
  getMemories,
  getMemoriesCount,
  getMemoriesStats,
  pruneMemories,
  getRepos as getMemoryRepos,
  searchKnowledge,
  getKnowledge,
  listKnowledge,
  getKnowledgeStats,
  getStaleKnowledge,
  deleteKnowledge,
} from "./memories.js";
import type { KnowledgeCategory, MemoryType } from "./types.js";

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
async function restartOpencodeServe(): Promise<{
  restarted: boolean;
  error?: string;
}> {
  return new Promise((resolve) => {
    // Find the opencode serve PID
    exec("pgrep -f 'opencode serve'", (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve({ restarted: false, error: "opencode serve not running" });
        return;
      }
      const pid = parseInt(stdout.trim().split("\n")[0], 10);
      if (isNaN(pid)) {
        resolve({
          restarted: false,
          error: "Could not determine opencode PID",
        });
        return;
      }

      // Get the process's working directory
      exec(
        `lsof -p ${pid} -Fn 2>/dev/null | grep '^n/' | head -1 | cut -c2-`,
        (cwdErr, cwdOut) => {
          const cwd = cwdOut?.trim() || os.homedir();

          // Send SIGTERM to opencode serve
          try {
            process.kill(pid, "SIGTERM");
          } catch {
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
              resolve({
                restarted: false,
                error: "Timeout waiting for opencode to stop",
              });
              return;
            } catch {
              // Process is dead, restart it
            }

            // Restart opencode serve in the background
            const child = exec(
              "nohup opencode serve > /dev/null 2>&1 &",
              { cwd, env: process.env },
              (restartErr) => {
                if (restartErr) {
                  resolve({
                    restarted: false,
                    error: `Restart failed: ${restartErr.message}`,
                  });
                  return;
                }
              },
            );

            // Wait for port 4096 to be listening again
            let readyAttempts = 0;
            const maxReadyAttempts = 30;
            const checkReady = () => {
              readyAttempts++;
              fetch(`${OPENCODE_SERVER}/provider`)
                .then((r) => {
                  if (r.ok) {
                    resolve({ restarted: true });
                  } else if (readyAttempts < maxReadyAttempts) {
                    setTimeout(checkReady, 500);
                  } else {
                    resolve({
                      restarted: false,
                      error: "opencode did not become ready in time",
                    });
                  }
                })
                .catch(() => {
                  if (readyAttempts < maxReadyAttempts) {
                    setTimeout(checkReady, 500);
                  } else {
                    resolve({
                      restarted: false,
                      error: "opencode did not become ready in time",
                    });
                  }
                });
            };
            setTimeout(checkReady, 1000);

            // Avoid unhandled rejection from the child process
            child.unref();
          };

          setTimeout(checkAndRestart, 500);
        },
      );
    });
  });
}

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

    const filePath = path.join(
      os.homedir(),
      ".config/opencode/agents",
      `${name}.md`,
    );

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

    const filePath = path.join(
      os.homedir(),
      ".config/opencode/agents",
      `${name}.md`,
    );

    try {
      fs.writeFileSync(filePath, content, "utf-8");
      // Restart opencode serve to pick up the modified agent file
      restartOpencodeServe().then(({ restarted, error }) => {
        if (!restarted && error !== "opencode serve not running") {
          console.warn(`[agents] opencode restart after save failed: ${error}`);
        }
      });
      res.json({ success: true, name });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/agents/hidden - Get list of hidden agent names
app.get("/api/agents/hidden", (_req: Request, res: Response) => {
  try {
    res.json({ hidden: getHiddenAgents() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/agents/global-file - Read global AGENTS.md file
app.get("/api/agents/global-file", (_req: Request, res: Response) => {
  try {
    const filePath = path.join(os.homedir(), ".config/opencode/AGENTS.md");
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      res.json({ content, path: filePath, exists: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        res.json({ content: "", path: filePath, exists: false });
      } else {
        throw err;
      }
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/agents/global-file - Write global AGENTS.md file
app.put("/api/agents/global-file", (req: Request, res: Response) => {
  try {
    const { content } = req.body as { content?: string };
    if (content === undefined || content === null) {
      res.status(400).json({ error: "Content is required" });
      return;
    }
    const filePath = path.join(os.homedir(), ".config/opencode/AGENTS.md");
    fs.writeFileSync(filePath, content, "utf-8");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /api/agents/:name/file - Delete agent markdown file
app.delete("/api/agents/:name/file", (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    // Validate agent name
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      res.status(400).json({ error: "Invalid agent name" });
      return;
    }

    const filePath = path.join(
      os.homedir(),
      ".config/opencode/agents",
      `${name}.md`,
    );

    try {
      // Delete the .md file if it exists
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      // Always hide from agent list
      hideAgent(name);
      res.json({ success: true, name });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Agents discovery (disk scan) ──────────────────────────

// GET /api/agents - List all agent files on disk with parsed frontmatter
app.get("/api/agents", (_req: Request, res: Response) => {
  try {
    const agentsDir = path.join(os.homedir(), ".config/opencode/agents");
    if (!fs.existsSync(agentsDir)) {
      res.json([]);
      return;
    }

    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    const agents: Array<{
      name: string;
      mode: string;
      description: string;
      model: string | null;
    }> = [];

    for (const file of files) {
      const name = file.replace(/\.md$/, "");
      const filePath = path.join(agentsDir, file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        // Parse YAML frontmatter (simple key: value extraction)
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        let mode = "primary";
        let description = name;
        let model: string | null = null;

        if (fmMatch) {
          for (const line of fmMatch[1].split("\n")) {
            const kv = line.match(/^(\w+):\s*(.+)$/);
            if (kv) {
              const [, key, val] = kv;
              if (key === "mode") mode = val.trim();
              else if (key === "description") description = val.trim();
              else if (key === "model") model = val.trim();
            }
          }
        }
        agents.push({ name, mode, description, model });
      } catch {
        // skip unreadable files
      }
    }
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Models API ───────────────────────────────────────────

// Cache available models from opencode
let cachedModels: { providerID: string; modelID: string; name: string }[] = [];
let modelsFetchedAt = 0;

// GET /api/models - List available models from opencode
app.get("/api/models", async (_req: Request, res: Response) => {
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

    const data = (await providerRes.json()) as {
      all: Array<{
        id: string;
        models: Record<string, { id: string; name: string }>;
      }>;
      connected?: string[];
    };

    const models: { providerID: string; modelID: string; name: string }[] = [];
    for (const provider of data.all) {
      if (data.connected && !data.connected.includes(provider.id)) continue;
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
  } catch {
    res.json(cachedModels.length > 0 ? cachedModels : []);
  }
});

// POST /api/agents - Create a new agent
app.post("/api/agents", (req: Request, res: Response) => {
  try {
    const { name, mode, description, model, content } = req.body as {
      name?: string;
      mode?: string;
      description?: string;
      model?: string;
      content?: string;
    };

    // Validate name
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      res.status(400).json({
        error:
          "Invalid agent name. Use only letters, numbers, hyphens, and underscores.",
      });
      return;
    }

    // Validate mode
    if (!mode || (mode !== "primary" && mode !== "subagent")) {
      res.status(400).json({ error: "Mode must be 'primary' or 'subagent'" });
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
    let fileContent: string;
    if (content) {
      fileContent = content;
    } else {
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
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Create new session via opencode ──────────────────────
app.post("/api/sessions", async (req: Request, res: Response) => {
  try {
    const { directory, board_id } = req.body as {
      directory?: string;
      board_id?: number;
    };
    const url = new URL(`${OPENCODE_SERVER}/session`);
    if (directory) url.searchParams.set("directory", directory);
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
        db.prepare(
          "UPDATE session SET directory = ?, path = ? WHERE id = ?",
        ).run(directory, directory.replace(/^\//, ""), session.id);
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
          .prepare(
            "SELECT id FROM kanban_boards WHERE repo_path = ? AND status = 'active'",
          )
          .get(directory) as { id: number } | undefined;
        if (board) {
          emitBoardChange("card_created", {
            session_id: session.id,
            board_id: board.id,
          });
        }
      } catch {
        // non-critical
      }
    }
    // Return updated session with corrected directory
    res.json({
      ...session,
      directory: directory || session.directory,
      path: directory ? directory.replace(/^\//, "") : session.path,
    });
  } catch (err) {
    res.status(502).json({
      error: `opencode server unreachable: ${(err as Error).message}`,
    });
  }
});

// ── Send message via opencode serve HTTP API ──────────────
app.post(
  "/api/sessions/:sessionId/send",
  async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { text, agent } = req.body as { text?: string; agent?: string };
      if (!text?.trim()) {
        res.status(400).json({ error: "Message text is required" });
        return;
      }

      // Build parts array — inject mandatory rules + memories + knowledge
      const parts: object[] = [];
      const mandatoryContext = getMandatoryContext(sessionId);
      if (mandatoryContext.trim()) {
        parts.push({
          type: "text",
          text: `<mandatory>\n${mandatoryContext}\n</mandatory>`,
        });
      }
      parts.push({ type: "text", text: text.trim() });

      const sessionDir = getSessionDirectory(sessionId);
      const messageUrl = new URL(
        `${OPENCODE_SERVER}/session/${sessionId}/prompt_async`,
      );
      if (sessionDir) messageUrl.searchParams.set("directory", sessionDir);
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
    } catch (err) {
      res.status(502).json({
        error: `opencode server unreachable: ${(err as Error).message}`,
      });
    }
  },
);

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
      res
        .status(opencodeRes.status)
        .json({ error: body || `opencode error ${opencodeRes.status}` });
      return;
    }
    const data = await opencodeRes.json();
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json(data);
  } catch (err) {
    res.status(502).json({
      error: `opencode server unreachable: ${(err as Error).message}`,
    });
  }
});

// POST reply to a question
app.post(
  "/api/opencode/question/:questionId/reply",
  async (req: Request, res: Response) => {
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
        res
          .status(opencodeRes.status)
          .json({ error: body || `opencode error ${opencodeRes.status}` });
        return;
      }
      const data = await opencodeRes.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({
        error: `opencode server unreachable: ${(err as Error).message}`,
      });
    }
  },
);

// POST reject a question
app.post(
  "/api/opencode/question/:questionId/reject",
  async (req: Request, res: Response) => {
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
        res
          .status(opencodeRes.status)
          .json({ error: body || `opencode error ${opencodeRes.status}` });
        return;
      }
      const data = await opencodeRes.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({
        error: `opencode server unreachable: ${(err as Error).message}`,
      });
    }
  },
);

// ── REST API Routes ─────────────────────────────────────────

// Boards
app.get("/api/boards", async (req: Request, res: Response) => {
  try {
    const repoPath = req.query.repo_path as string | undefined;
    const boards = listBoards(repoPath);

    if (boards.length === 0) {
      res.json(boards);
      return;
    }

    try {
      // Collect unique repo_paths across boards
      const uniqueRepoPaths = [
        ...new Set(boards.map((b) => b.repo_path).filter(Boolean)),
      ];

      // Fetch session statuses for each repo_path in parallel
      const statusByRepoPath = new Map<
        string,
        Record<string, { type: string }>
      >();

      await Promise.all(
        uniqueRepoPaths.map(async (rp) => {
          try {
            const statusUrl = new URL(`${OPENCODE_SERVER}/session/status`);
            statusUrl.searchParams.set("directory", rp);
            const statusRes = await fetch(statusUrl.toString());
            if (statusRes.ok) {
              statusByRepoPath.set(
                rp,
                (await statusRes.json()) as Record<string, { type: string }>,
              );
            }
          } catch {
            // Per-repo status fetch is non-critical
          }
        }),
      );

      // Get all active sessions from DB (same query as getBoardFull)
      const allSessions = getDb()
        .prepare(
          "SELECT id, directory FROM session WHERE parent_id IS NULL AND id NOT IN (SELECT session_id FROM kanban_deleted_sessions)",
        )
        .all() as { id: string; directory: string }[];

      // Build a lookup: repo_path -> Set of busy session IDs
      const busySessionsByRepoPath = new Map<string, Set<string>>();

      for (const rp of uniqueRepoPaths) {
        const statuses = statusByRepoPath.get(rp);
        if (!statuses) continue;

        const busySet = new Set<string>();
        for (const session of allSessions) {
          if (
            (session.directory === rp ||
              session.directory.startsWith(rp + "/")) &&
            (statuses[session.id]?.type === "busy" ||
              statuses[session.id]?.type === "retry")
          ) {
            busySet.add(session.id);
          }
        }
        busySessionsByRepoPath.set(rp, busySet);
      }

      // Set has_busy on each board
      for (const board of boards) {
        const busySet = busySessionsByRepoPath.get(board.repo_path);
        board.has_busy = busySet !== undefined && busySet.size > 0;
      }
    } catch {
      // Status computation is non-critical; boards keep has_busy undefined
    }

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
      if (boardFull.board.repo_path)
        statusUrl.searchParams.set("directory", boardFull.board.repo_path);
      const statusRes = await fetch(statusUrl.toString());
      if (statusRes.ok) {
        const statuses = (await statusRes.json()) as Record<
          string,
          { type: string }
        >;
        for (const card of boardFull.cards) {
          card.is_busy =
            statuses[card.session_id]?.type === "busy" ||
            statuses[card.session_id]?.type === "retry" ||
            false;
        }
      }
    } catch {
      // Status fetch is non-critical; cards default to is_busy = undefined
    }

    // Propagate has_busy to the board for sidebar indicator
    boardFull.board.has_busy = boardFull.cards.some((c) => c.is_busy === true);

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
    // Subscribe to SSE for new board's workspace
    connectToOpencodeSSE(repo_path);
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

app.put("/api/boards/reorder", (req: Request, res: Response) => {
  try {
    const { board_ids } = req.body;
    if (!Array.isArray(board_ids) || board_ids.length === 0) {
      return res.status(400).json({ error: "board_ids array is required" });
    }
    reorderBoards(board_ids);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── GitHub integration ─────────────────────────────────────────

// GET config (token masked)
app.get("/api/boards/:id/github/config", (req: Request, res: Response) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    const config = getGitHubConfig(boardId);
    if (!config) {
      return res.json({
        board_id: boardId,
        has_token: false,
        token_masked: "",
        selected_repos: [],
        selected_projects: [],
        created_at: "",
        updated_at: "",
      } satisfies import("./types.js").GitHubConfig);
    }
    const token = config.github_token;
    const masked =
      token.length > 8 ? token.slice(0, 4) + "****" + token.slice(-4) : "****";
    res.json({
      board_id: config.board_id,
      has_token: true,
      token_masked: masked,
      selected_repos: JSON.parse(config.selected_repos || "[]"),
      selected_projects: JSON.parse(config.selected_projects || "[]"),
      created_at: config.created_at,
      updated_at: config.updated_at,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// PUT save token + validate
app.put(
  "/api/boards/:id/github/config",
  async (req: Request, res: Response) => {
    try {
      const boardId = parseInt(req.params.id, 10);
      const { token } = req.body as { token?: string };
      if (!token?.trim()) {
        return res.status(400).json({ error: "Token is required" });
      }
      // Validate the token first
      const validation = await validateGitHubToken(token.trim());
      if (!validation.valid) {
        return res.status(400).json({ error: "Invalid GitHub token" });
      }
      // Save with empty selected repos initially
      saveGitHubConfig(boardId, token.trim(), []);
      res.json({ success: true, user: validation.user });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  },
);

// DELETE remove config
app.delete("/api/boards/:id/github/config", (req: Request, res: Response) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    deleteGitHubConfig(boardId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET accessible repos (from stored token)
app.get("/api/boards/:id/github/repos", async (req: Request, res: Response) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    const config = getGitHubConfig(boardId);
    if (!config) {
      return res
        .status(404)
        .json({ error: "GitHub not configured for this board" });
    }
    const repos = await listGitHubRepos(config.github_token);
    const selectedRepos: string[] = JSON.parse(config.selected_repos || "[]");
    res.json({ repos, selected_repos: selectedRepos });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// PUT update selected repos
app.put("/api/boards/:id/github/repos", (req: Request, res: Response) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    const { selected_repos } = req.body as { selected_repos?: string[] };
    if (!Array.isArray(selected_repos)) {
      return res.status(400).json({ error: "selected_repos must be an array" });
    }
    updateGitHubSelectedRepos(boardId, selected_repos);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// PUT update selected projects
app.put("/api/boards/:id/github/projects", (req: Request, res: Response) => {
  try {
    const boardId = parseInt(req.params.id);
    const { selected_projects } = req.body as { selected_projects: string[] };
    if (!Array.isArray(selected_projects)) {
      res.status(400).json({ error: "selected_projects must be an array" });
      return;
    }
    updateGitHubSelectedProjects(boardId, selected_projects);
    res.json({ ok: true });
  } catch (error) {
    console.error("[github] Failed to save selected projects:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET issues for selected repos
app.get(
  "/api/boards/:id/github/issues",
  async (req: Request, res: Response) => {
    try {
      const boardId = parseInt(req.params.id, 10);
      const config = getGitHubConfig(boardId);
      if (!config) {
        return res
          .status(404)
          .json({ error: "GitHub not configured for this board" });
      }
      const selectedRepos: string[] = JSON.parse(config.selected_repos || "[]");
      if (selectedRepos.length === 0) {
        return res.json({ repos: {} });
      }
      const state = (req.query.state as string) || "open";
      const repoParam = req.query.repo as string | undefined;

      // If specific repo requested, only fetch that one
      const reposToFetch = repoParam ? [repoParam] : selectedRepos;
      const result: Record<string, import("./types.js").GitHubIssue[]> = {};

      for (const fullName of reposToFetch) {
        try {
          const { owner, repo } = parseRepoFullName(fullName);
          const { issues } = await listGitHubIssues(
            config.github_token,
            owner,
            repo,
            {
              state: state as "open" | "closed" | "all",
            },
          );
          result[fullName] = issues;
        } catch (err) {
          // If one repo fails, still return others
          result[fullName] = [];
          console.error(
            `[github] Failed to fetch issues for ${fullName}:`,
            err,
          );
        }
      }
      res.json({ repos: result });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  },
);

// GET single issue detail
app.get(
  "/api/boards/:id/github/issues/:owner/:repo/:number",
  async (req: Request, res: Response) => {
    try {
      const boardId = parseInt(req.params.id, 10);
      const config = getGitHubConfig(boardId);
      if (!config) {
        return res
          .status(404)
          .json({ error: "GitHub not configured for this board" });
      }
      const { owner, repo, number } = req.params;
      const issue = await getGitHubIssue(
        config.github_token,
        owner,
        repo,
        parseInt(number, 10),
      );
      res.json(issue);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  },
);

// POST spawn agent from issue
app.post(
  "/api/boards/:id/github/spawn",
  async (req: Request, res: Response) => {
    try {
      const boardId = parseInt(req.params.id, 10);
      const { issue, agent } = req.body as {
        issue?: {
          title: string;
          body: string;
          html_url: string;
          number: number;
          repository_url: string;
        };
        agent?: string;
      };
      if (!issue) {
        return res.status(400).json({ error: "Issue data is required" });
      }

      // Get board info for directory
      const boardFull = getBoardFull(boardId);

      // Create session via opencode
      const url = new URL(`${OPENCODE_SERVER}/session`);
      if (boardFull.board.repo_path)
        url.searchParams.set("directory", boardFull.board.repo_path);
      const sessionRes = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `GH #${issue.number}: ${issue.title}` }),
      });
      if (!sessionRes.ok) {
        const body = await sessionRes.text().catch(() => "");
        return res
          .status(sessionRes.status)
          .json({ error: body || `opencode error ${sessionRes.status}` });
      }
      const session = await sessionRes.json();

      // Build the prompt from the issue
      const prompt = `## GitHub Issue #${issue.number}\n\n**Title:** ${issue.title}\n**URL:** ${issue.html_url}\n\n${issue.body || "(no description)"}\n\n---\n\nPlease analyze and address this GitHub issue.`;

      // Send the message via opencode
      const parts: object[] = [];
      const mandatoryContext = getMandatoryContext(session.id);
      if (mandatoryContext.trim()) {
        parts.push({
          type: "text",
          text: `<mandatory>\n${mandatoryContext}\n</mandatory>`,
        });
      }
      parts.push({ type: "text", text: prompt });

      const messageUrl = new URL(
        `${OPENCODE_SERVER}/session/${session.id}/prompt_async`,
      );
      const sessionDir =
        getSessionDirectory(session.id) || boardFull.board.repo_path;
      if (sessionDir) messageUrl.searchParams.set("directory", sessionDir);
      await fetch(messageUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts, ...(agent ? { agent } : {}) }),
      });

      emitBoardChange("card_created", {
        session_id: session.id,
        board_id: boardId,
      });
      res.json({ session_id: session.id, title: session.title });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  },
);

// ── GitHub Projects ────────────────────────────────────────────

app.get(
  "/api/boards/:id/github/projects",
  async (req: Request, res: Response) => {
    try {
      const boardId = parseInt(req.params.id);
      const config = getGitHubConfig(boardId);
      if (!config) {
        res.json({ projects: [] });
        return;
      }
      const projects = await listGitHubProjects(config.github_token);
      // If ?all=true, return all projects (for picker)
      if (req.query.all === "true") {
        res.json({ projects });
        return;
      }
      // Otherwise filter to selected projects
      const selectedProjects = JSON.parse(config.selected_projects || "[]");
      const filtered =
        selectedProjects.length > 0
          ? projects.filter((p: { id: string }) =>
              selectedProjects.includes(p.id),
            )
          : [];
      res.json({ projects: filtered });
    } catch (error) {
      console.error("[github] Failed to fetch projects:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  },
);

app.get(
  "/api/boards/:id/github/projects/:projectId/items",
  async (req: Request, res: Response) => {
    try {
      const boardId = parseInt(req.params.id);
      const { projectId } = req.params;
      const config = getGitHubConfig(boardId);
      if (!config) {
        res.json({ items: [] });
        return;
      }
      const items = await listGitHubProjectItems(
        config.github_token,
        projectId,
      );
      res.json({ items });
    } catch (error) {
      console.error("[github] Failed to fetch project items:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  },
);

// ── Linear integration ─────────────────────────────────────────

// GET Linear config (token masked)
app.get("/api/boards/:id/linear/config", (req: Request, res: Response) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    const config = getLinearConfig(boardId);
    if (!config) {
      return res.json({
        board_id: boardId,
        has_token: false,
        token_masked: "",
        selected_teams: [],
        created_at: "",
        updated_at: "",
      });
    }
    const token = config.linear_api_key;
    const masked =
      token.length > 8 ? token.slice(0, 7) + "****" + token.slice(-4) : "****";
    res.json({
      board_id: config.board_id,
      has_token: true,
      token_masked: masked,
      selected_teams: JSON.parse(config.selected_teams || "[]"),
      created_at: config.created_at,
      updated_at: config.updated_at,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// PUT save Linear API key + validate
app.put(
  "/api/boards/:id/linear/config",
  async (req: Request, res: Response) => {
    try {
      const boardId = parseInt(req.params.id, 10);
      const { token } = req.body as { token?: string };
      if (!token?.trim()) {
        return res.status(400).json({ error: "API key is required" });
      }
      const validation = await validateLinearToken(token.trim());
      if (!validation.valid) {
        return res.status(400).json({ error: "Invalid Linear API key" });
      }
      saveLinearConfig(boardId, token.trim());
      res.json({ success: true, user: validation.user });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  },
);

// DELETE remove Linear config
app.delete("/api/boards/:id/linear/config", (req: Request, res: Response) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    deleteLinearConfig(boardId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET accessible teams (from stored API key)
app.get("/api/boards/:id/linear/teams", async (req: Request, res: Response) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    const config = getLinearConfig(boardId);
    if (!config) {
      return res
        .status(404)
        .json({ error: "Linear not configured for this board" });
    }
    const teams = await listLinearTeams(config.linear_api_key);
    const selectedTeams: string[] = JSON.parse(config.selected_teams || "[]");
    res.json({ teams, selected_teams: selectedTeams });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// PUT update selected teams
app.put("/api/boards/:id/linear/teams", (req: Request, res: Response) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    const { selected_teams } = req.body as { selected_teams?: string[] };
    if (!Array.isArray(selected_teams)) {
      return res.status(400).json({ error: "selected_teams must be an array" });
    }
    updateLinearSelectedTeams(boardId, selected_teams);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET issues for selected teams
app.get(
  "/api/boards/:id/linear/issues",
  async (req: Request, res: Response) => {
    try {
      const boardId = parseInt(req.params.id, 10);
      const config = getLinearConfig(boardId);
      if (!config) {
        return res
          .status(404)
          .json({ error: "Linear not configured for this board" });
      }

      const selectedTeams: string[] = JSON.parse(config.selected_teams || "[]");
      if (selectedTeams.length === 0) {
        return res.json({ issues: [], teams: [] });
      }

      const stateType = (req.query.stateType as string) || undefined;
      const teamFilter = req.query.team as string | undefined;

      const teamIds = teamFilter
        ? selectedTeams.filter((t) => t === teamFilter)
        : selectedTeams;

      const result = await listLinearIssues(config.linear_api_key, teamIds, {
        stateType,
      });

      res.json({ issues: result.issues, teams: selectedTeams });
    } catch (error) {
      console.error("[linear] Failed to fetch issues:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  },
);

// POST spawn agent from Linear issue
app.post(
  "/api/boards/:id/linear/spawn",
  async (req: Request, res: Response) => {
    try {
      const boardId = parseInt(req.params.id, 10);
      const { issue, agent } = req.body as {
        issue?: {
          identifier: string;
          title: string;
          description: string;
          url: string;
          team_key: string;
        };
        agent?: string;
      };
      if (!issue) {
        return res.status(400).json({ error: "Issue data is required" });
      }

      const boardFull = getBoardFull(boardId);

      const url = new URL(`${OPENCODE_SERVER}/session`);
      if (boardFull.board.repo_path)
        url.searchParams.set("directory", boardFull.board.repo_path);
      const sessionRes = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `${issue.identifier}: ${issue.title}` }),
      });
      if (!sessionRes.ok) {
        const body = await sessionRes.text().catch(() => "");
        return res
          .status(sessionRes.status)
          .json({ error: body || `opencode error ${sessionRes.status}` });
      }
      const session = await sessionRes.json();

      const prompt = `## Linear Issue ${issue.identifier}\n\n**Title:** ${issue.title}\n**URL:** ${issue.url}\n\n${issue.description || "(no description)"}\n\n---\n\nPlease analyze and address this Linear issue.`;

      const parts: object[] = [];
      const mandatoryContext = getMandatoryContext(session.id);
      if (mandatoryContext.trim()) {
        parts.push({
          type: "text",
          text: `<mandatory>\n${mandatoryContext}\n</mandatory>`,
        });
      }
      parts.push({ type: "text", text: prompt });

      const messageUrl = new URL(
        `${OPENCODE_SERVER}/session/${session.id}/prompt_async`,
      );
      const sessionDir =
        getSessionDirectory(session.id) || boardFull.board.repo_path;
      if (sessionDir) messageUrl.searchParams.set("directory", sessionDir);
      await fetch(messageUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts, ...(agent ? { agent } : {}) }),
      });

      emitBoardChange("card_created", {
        session_id: session.id,
        board_id: boardId,
      });
      res.json({ session_id: session.id, title: session.title });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  },
);

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

// ── Memories API ──────────────────────────────────────────────

// Search memories
app.get("/api/memories/search", (req: Request, res: Response) => {
  try {
    const repo_path = req.query.repo_path as string;
    const query = req.query.query as string;
    if (!repo_path || !query) {
      return res
        .status(400)
        .json({ error: "repo_path and query are required" });
    }
    const results = searchMemories(repo_path, {
      query,
      agentName: req.query.agent_name as string | undefined,
      memoryType: req.query.memory_type as MemoryType | undefined,
      conversationId: req.query.conversation_id as string | undefined,
      limit: parseInt(req.query.limit as string) || 20,
    });
    res.json({ count: results.length, memories: results });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// List memories (paginated)
app.get("/api/memories", (req: Request, res: Response) => {
  try {
    const repo_path = req.query.repo_path as string;
    if (!repo_path) {
      return res.status(400).json({ error: "repo_path is required" });
    }
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const memoryType = req.query.memory_type as string | undefined;
    const results = getMemories(repo_path, {
      conversationId: req.query.conversation_id as string | undefined,
      agentName: req.query.agent_name as string | undefined,
      memoryType,
      limit,
      offset,
    });
    const total = getMemoriesCount(repo_path, { memoryType });
    res.json({ count: results.length, total, memories: results });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Prune memories
app.post("/api/memories/prune", (req: Request, res: Response) => {
  try {
    const { repo_path, keep_days, keep_important } = req.body as {
      repo_path?: string;
      keep_days?: number;
      keep_important?: boolean;
    };
    if (!repo_path) {
      return res.status(400).json({ error: "repo_path is required" });
    }
    const removed = pruneMemories(repo_path, {
      keepDays: keep_days || 90,
      keepImportant: keep_important !== false,
    });
    res.json({ removed });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// List repos with memories
app.get("/api/memories/repos", (_req: Request, res: Response) => {
  try {
    const repos = getMemoryRepos();
    res.json({ count: repos.length, repos });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Memories stats (counts per type)
app.get("/api/memories/stats", (req: Request, res: Response) => {
  try {
    const repo_path = req.query.repo_path as string;
    if (!repo_path) {
      return res.status(400).json({ error: "repo_path is required" });
    }
    const stats = getMemoriesStats(repo_path);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Search knowledge
app.get("/api/knowledge/search", (req: Request, res: Response) => {
  try {
    const repo_path = req.query.repo_path as string;
    const query = req.query.query as string;
    if (!repo_path || !query) {
      return res
        .status(400)
        .json({ error: "repo_path and query are required" });
    }
    const results = searchKnowledge(repo_path, {
      query,
      category: req.query.category as KnowledgeCategory | undefined,
      limit: parseInt(req.query.limit as string) || 30,
    });
    res.json({ count: results.length, entries: results });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get specific knowledge entry
app.get("/api/knowledge/entry", (req: Request, res: Response) => {
  try {
    const repo_path = req.query.repo_path as string;
    const category = req.query.category as KnowledgeCategory;
    const key = req.query.key as string;
    if (!repo_path || !category || !key) {
      return res
        .status(400)
        .json({ error: "repo_path, category, and key are required" });
    }
    const result = getKnowledge(repo_path, { category, key });
    if (!result) {
      return res.status(404).json({ error: "Entry not found" });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// List knowledge entries
app.get("/api/knowledge", (req: Request, res: Response) => {
  try {
    const repo_path = req.query.repo_path as string;
    if (!repo_path) {
      return res.status(400).json({ error: "repo_path is required" });
    }
    const limit = parseInt(req.query.limit as string) || 200;
    const offset = parseInt(req.query.offset as string) || 0;
    const category = req.query.category as KnowledgeCategory | undefined;
    const results = listKnowledge(repo_path, {
      category,
      limit,
      offset,
    });
    const stats = getKnowledgeStats(repo_path);
    res.json({ count: results.length, total: stats.total, entries: results });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Knowledge stats
app.get("/api/knowledge/stats", (req: Request, res: Response) => {
  try {
    const repo_path = req.query.repo_path as string;
    if (!repo_path) {
      return res.status(400).json({ error: "repo_path is required" });
    }
    const stats = getKnowledgeStats(repo_path);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Stale knowledge
app.get("/api/knowledge/stale", (req: Request, res: Response) => {
  try {
    const repo_path = req.query.repo_path as string;
    if (!repo_path) {
      return res.status(400).json({ error: "repo_path is required" });
    }
    const results = getStaleKnowledge(repo_path, {
      category: req.query.category as KnowledgeCategory | undefined,
      olderThanDays: parseInt(req.query.older_than_days as string) || 7,
      limit: parseInt(req.query.limit as string) || 100,
    });
    res.json({ count: results.length, entries: results });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete knowledge entry
app.delete("/api/knowledge", (req: Request, res: Response) => {
  try {
    const repo_path = req.query.repo_path as string;
    const category = req.query.category as KnowledgeCategory;
    const key = req.query.key as string;
    if (!repo_path || !category || !key) {
      return res
        .status(400)
        .json({ error: "repo_path, category, and key are required" });
    }
    const deleted = deleteKnowledge(repo_path, { category, key });
    res.json({ deleted });
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
    const { title, content, enabled } = req.body as {
      title?: string;
      content?: string;
      enabled?: boolean;
    };
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

  // Listen to all event types (includes opencode_session_status)
  const cleanup: (() => void)[] = [];
  for (const eventType of Object.values(EVENT_TYPES)) {
    const typedHandler = (payload: any) =>
      handler({ type: eventType, ...payload });
    bus.on(eventType as KanbanEvents, typedHandler as any);
    cleanup.push(() => bus.off(eventType as KanbanEvents, typedHandler as any));
  }

  req.on("close", () => {
    cleanup.forEach((fn) => fn());
  });
});

// Home directory for workspace picker
app.get("/api/home", (_req: Request, res: Response) => {
  res.json({ home: os.homedir() });
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

// File search for @ mentions
app.get("/api/filesystem/search-files", (req: Request, res: Response) => {
  try {
    let dirPath = (req.query.directory as string) || "";
    const query = ((req.query.query as string) || "").toLowerCase();

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

    const files: Array<{ name: string; relativePath: string }> = [];
    const MAX_RESULTS = 200;

    try {
      const entries = fs.readdirSync(dirPath, {
        recursive: true,
        withFileTypes: false,
      }) as string[];

      for (const entry of entries) {
        if (files.length >= MAX_RESULTS) break;

        // Skip hidden files/dirs
        const parts = entry.split("/");
        if (parts.some((p) => p.startsWith(".") || skipDirs.has(p))) continue;

        const fullPath = path.join(dirPath, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isFile()) continue;
        } catch {
          continue;
        }

        const relativePath = entry;
        const name = path.basename(entry);

        // Apply query filter
        if (query && !relativePath.toLowerCase().includes(query)) continue;

        files.push({ name, relativePath });
      }
    } catch {
      // Directory may not exist or be unreadable
    }

    res.json({ files });
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
      return res
        .status(400)
        .json({ error: "Object with key/value pairs required" });
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
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Compaction proxy ────────────────────────────────────────

/** Extract providerID and modelID from a session's model data */
function getSessionModelParts(
  sessionId: string,
): { providerID: string; modelID: string } | null {
  const raw = getSessionModel(sessionId);
  if (!raw) return null;
  try {
    // Model may already be an object { providerID, modelID }
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.providerID &&
      parsed.modelID
    ) {
      return { providerID: parsed.providerID, modelID: parsed.modelID };
    }
  } catch {}
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

app.post(
  "/api/sessions/:sessionId/compact",
  async (req: Request, res: Response) => {
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
      const summarizeUrl = new URL(
        `${OPENCODE_SERVER}/session/${sessionId}/summarize`,
      );
      if (sessionDir) summarizeUrl.searchParams.set("directory", sessionDir);

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
            console.error(
              `[compact] summarize failed for ${sessionId}: ${opencodeRes.status}`,
            );
          }
        })
        .catch((err) => {
          console.error(
            `[compact] summarize error for ${sessionId}:`,
            err.message,
          );
        })
        .finally(() => {
          // Always clear the compacting flag
          setSessionCompacting(sessionId, false);
          console.log(`[compact] completed for ${sessionId}`);
        });
    } catch (err) {
      // If headers not yet sent, send error; otherwise just log
      if (!res.headersSent) {
        res.status(502).json({
          error: `opencode server unreachable: ${(err as Error).message}`,
        });
      }
      // Clear compacting flag if we set it
      const { sessionId } = req.params;
      if (sessionId) setSessionCompacting(sessionId, false);
    }
  },
);

app.get(
  "/api/sessions/:sessionId/compacting",
  async (_req: Request, res: Response) => {
    const { sessionId } = _req.params;
    const compacting = isSessionCompacting(sessionId);
    res.json({ compacting });
  },
);

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

// Track directories we've already connected to
const connectedDirectories = new Set<string>();

function connectToOpencodeSSE(directory: string) {
  if (!directory || connectedDirectories.has(directory)) return;
  connectedDirectories.add(directory);

  const connect = () => {
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
                if (
                  eventData.type === "session.status" &&
                  eventData.properties?.sessionID
                ) {
                  const sessionID = eventData.properties.sessionID;
                  const currentStatus =
                    eventData.properties.status?.type ||
                    eventData.properties.status;

                  bus.emit(
                    "opencode_session_status" as any,
                    {
                      sessionID,
                      status: eventData.properties.status,
                    } as any,
                  );
                }
                // Relay streaming message events to frontend via event bus
                if (
                  eventData.type === "message.part.updated" &&
                  eventData.properties?.sessionID
                ) {
                  bus.emit(
                    "opencode_message_part_updated" as any,
                    {
                      sessionID: eventData.properties.sessionID,
                      part: eventData.properties.part,
                    } as any,
                  );
                }
                if (
                  eventData.type === "message.updated" &&
                  eventData.properties?.sessionID
                ) {
                  bus.emit(
                    "opencode_message_updated" as any,
                    {
                      sessionID: eventData.properties.sessionID,
                      info: eventData.properties.info,
                    } as any,
                  );
                }
                // Relay incremental text deltas for efficient streaming
                if (
                  eventData.type === "message.part.delta" &&
                  eventData.properties?.sessionID
                ) {
                  bus.emit(
                    "opencode_message_part_delta" as any,
                    {
                      sessionID: eventData.properties.sessionID,
                      messageID: eventData.properties.messageID,
                      partID: eventData.properties.partID,
                      field: eventData.properties.field,
                      delta: eventData.properties.delta,
                    } as any,
                  );
                }
              } catch {
                // ignore parse errors
              }
            }
          }
        });
        upstreamRes.on("end", () => {
          setTimeout(connect, 3000);
        });
      });
      req.on("error", () => {
        setTimeout(connect, 5000);
      });
      req.end();
    } catch {
      setTimeout(connect, 5000);
    }
  };

  connect();
}

function subscribeToOpencodeEvents() {
  // Connect for each active board's workspace
  try {
    const boards = listBoards();
    for (const board of boards) {
      if (board.repo_path) connectToOpencodeSSE(board.repo_path);
    }
  } catch {
    // retry later
  }
}

subscribeToOpencodeEvents();

// ── Version Check Endpoint ─────────────────────────────────

let latestReleaseCache: { data: any; timestamp: number } | null = null;
const RELEASE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const GITHUB_REPO = "fernando-pineda/opencode-kanban";

function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

app.get("/api/version", async (_req: Request, res: Response) => {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const currentVersion = pkg.version;

    let latestRelease: any = null;

    if (
      latestReleaseCache &&
      Date.now() - latestReleaseCache.timestamp < RELEASE_CACHE_TTL
    ) {
      latestRelease = latestReleaseCache.data;
    } else {
      try {
        const githubUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
        const response = await fetch(githubUrl, {
          headers: { "User-Agent": "opencode-kanban" },
        });
        if (response.ok) {
          latestRelease = await response.json();
          latestReleaseCache = {
            data: latestRelease,
            timestamp: Date.now(),
          };
        }
      } catch {
        // GitHub API unavailable — continue with null latestRelease
      }
    }

    if (latestRelease && latestRelease.tag_name) {
      const latestVersion = latestRelease.tag_name;
      res.json({
        current: currentVersion,
        latest: latestVersion,
        updateAvailable: compareSemver(latestVersion, currentVersion) > 0,
        releaseUrl: latestRelease.html_url,
        releaseName: latestRelease.name,
      });
    } else {
      res.json({
        current: currentVersion,
        latest: null,
        updateAvailable: false,
        error: "Failed to fetch latest release",
      });
    }
  } catch {
    res.json({
      current: "unknown",
      latest: null,
      updateAvailable: false,
      error: "Failed to read version info",
    });
  }
});

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
