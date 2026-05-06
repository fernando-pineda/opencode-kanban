[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

# opencode-kanban

A **Kanban board + Memory + Knowledge system** for AI agents. Provides an MCP server that exposes kanban boards, cards, memory, and knowledge base tools to power intelligent coding assistants.

## 🚀 Quick Start

```bash
git clone https://github.com/fernando-pineda/opencode-kanban.git
cd opencode-kanban
./install.sh
```

The installer handles everything:
- ✅ Checks prerequisites (Node.js ≥18, opencode CLI)
- ✅ Builds backend + web frontend
- ✅ Registers the MCP server with opencode
- ✅ Deploys agent configs (plan, build, ask, builder)
- ✅ Sets up macOS launchd services (auto-start on login)
- ✅ Verifies the installation

Re-run `./install.sh` after pulling updates (idempotent). Use `--force` to overwrite agent files.

## 💡 Why?

### The terminal is expensive

Modern terminal emulators are GPU-accelerated applications. Ghostty uses **Metal rendering on macOS** and **OpenGL on Linux** with multi-threaded read/write/render pipelines per terminal session. That's a dedicated GPU compositor running just to display text — and it shows in your battery life.

As a developer, your browser is already open all day: docs, PRs, dashboards, CI logs, Linear tickets. opencode-kanban moves your agent conversations into **a browser tab** — no GPU overhead, no extra battery drain, no window management. One tab. One dashboard.

### Real swarm orchestration

Most AI coding tools are single-agent: you ask, it responds, one conversation at a time. Anthropic's [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) research identifies the **orchestrator-workers pattern** — where a central agent dynamically decomposes tasks and delegates them to parallel workers — as one of the most effective architectures for complex coding tasks.

opencode-kanban makes this pattern first-class:

1. You describe a task to the **planner** agent
2. The planner breaks it into parallel subtasks
3. Each subtask **spawns its own agent session** — its own conversation, its own git worktree, its own model
4. Agents execute simultaneously, each working on a different part of your codebase
5. The kanban board tracks every agent, every branch, every file change — **in real time**

This isn't sequential hand-offs. This is true parallel execution with live observability.

### Visibility into the black box

When an AI agent modifies your codebase, you need to know:

- **What is each agent doing right now?** — Board columns show live status
- **What decisions did it make?** — Memory system captures decisions, findings, and patterns across sessions
- **What files did it change?** — Each card tracks its git branch and diffs
- **Can I trust the result?** — Full agent logs, subtask tracking, and session history

The terminal is great for quick edits. But when you're orchestrating 3–5 agents working in parallel across your codebase, you need a **dashboard** — not five terminal panes you can't keep track of.

## 🎯 What It Does

- **Kanban Boards** — Visual task management with drag-and-drop columns
- **Session Cards** — Linked to opencode conversations for full context
- **Memory System** — Persists decisions, findings, and patterns across sessions
- **Knowledge Base** — Indexes files, commands, architecture, APIs, schemas, and gotchas
- **Agent Logging** — Tracks agent actions and subtask execution
- **Web UI** — Real-time dashboard at http://localhost:3210
- **MCP Server** — Tools available to any AI agent via opencode CLI

## 📦 Architecture

| Component | Purpose |
|-----------|---------|
| `src/` | MCP server (Hono + better-sqlite3 + sqlite-vec) |
| `web/` | React frontend (Vite + shadcn/ui + Tailwind) |
| `agents/` | Agent definitions (plan, build, ask, builder) |
| `templates/` | AGENTS.md with memory system rules |
| `scripts/` | Helper scripts (auto-generated launchd services) |

## ⚙️ Services

Two persistent services run on macOS via launchd:

- **Web Server** — Port 3210 (web UI + SSE events)
- **opencode serve** — Port 4096 (MCP server for agents)

Both auto-start on login after installation.

## 🛠 Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev        # Starts both web (5173) and server (3210)

# Build for production
npm run build

# Run linter
npm run lint

# Run tests
npm run test
```

## 📚 Documentation

- **Agent Integration** — See `templates/AGENTS.md` for memory system rules and agent setup
- **MCP Tools** — Check `src/index.ts` for available kanban, memory, and knowledge tools
- **Web UI** — Built with React + Tailwind; see `web/` for components

## 📝 License

MIT
