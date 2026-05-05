-- Kanban boards — ONE per environment/folder, auto-created
CREATE TABLE IF NOT EXISTS kanban_boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  repo_path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Kanban columns — lanes per board
CREATE TABLE IF NOT EXISTS kanban_columns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(board_id, name)
);

-- Kanban completed — tracks sessions explicitly marked as done
CREATE TABLE IF NOT EXISTS kanban_completed (
  session_id TEXT PRIMARY KEY,
  completed_at TEXT DEFAULT (datetime('now'))
);

-- Kanban session columns — explicit column assignment for sessions (manual moves)
CREATE TABLE IF NOT EXISTS kanban_session_columns (
  session_id TEXT PRIMARY KEY,
  column_name TEXT NOT NULL DEFAULT 'Backlog',
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Kanban deleted sessions — sessions hidden from the kanban board
CREATE TABLE IF NOT EXISTS kanban_deleted_sessions (
  session_id TEXT PRIMARY KEY,
  deleted_at TEXT DEFAULT (datetime('now'))
);

-- Kanban subtasks — agent tracking within a session, grouped by repository/worktree
CREATE TABLE IF NOT EXISTS kanban_subtasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  agent_type TEXT NOT NULL CHECK(agent_type IN ('primary', 'subagent')),
  title TEXT NOT NULL DEFAULT '',
  repository TEXT NOT NULL DEFAULT '',
  worktree TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'dispatched', 'started', 'progress', 'completed', 'failed', 'escalated')),
  progress INTEGER NOT NULL DEFAULT 0,
  details TEXT DEFAULT '',
  result_summary TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

-- Kanban agent logs — audit trail per session
CREATE TABLE IF NOT EXISTS kanban_agent_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  subtask_id INTEGER REFERENCES kanban_subtasks(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL,
  agent_type TEXT NOT NULL CHECK(agent_type IN ('primary', 'subagent')),
  action TEXT NOT NULL,
  details TEXT DEFAULT '',
  timestamp TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_kanban_subtasks_session ON kanban_subtasks(session_id);
CREATE INDEX IF NOT EXISTS idx_kanban_subtasks_repo ON kanban_subtasks(session_id, repository);
CREATE INDEX IF NOT EXISTS idx_kanban_logs_session ON kanban_agent_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_kanban_logs_subtask ON kanban_agent_logs(subtask_id);
CREATE INDEX IF NOT EXISTS idx_kanban_boards_repo ON kanban_boards(repo_path);
CREATE INDEX IF NOT EXISTS idx_kanban_boards_status ON kanban_boards(status);
CREATE INDEX IF NOT EXISTS idx_kanban_completed_session ON kanban_completed(session_id);
CREATE INDEX IF NOT EXISTS idx_kanban_session_columns_session ON kanban_session_columns(session_id);
CREATE INDEX IF NOT EXISTS idx_kanban_deleted_sessions_session ON kanban_deleted_sessions(session_id);

-- Rules — user-defined rules injected into every message as <mandatory> tags
CREATE TABLE IF NOT EXISTS kanban_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Settings — key/value store for general configuration
CREATE TABLE IF NOT EXISTS kanban_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kanban_settings_key ON kanban_settings(key);
