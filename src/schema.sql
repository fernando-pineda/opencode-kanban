-- Kanban boards — ONE per environment/folder, auto-created
CREATE TABLE IF NOT EXISTS kanban_boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  repo_path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  position INTEGER NOT NULL DEFAULT 0,
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

-- Epics: epic tracking with task keys
CREATE TABLE IF NOT EXISTS kanban_epics (
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

-- Epic sessions: spawned sessions linked to an epic
CREATE TABLE IF NOT EXISTS kanban_epic_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  epic_id INTEGER NOT NULL REFERENCES kanban_epics(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  task_key TEXT NOT NULL,
  subtask_index INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  UNIQUE(epic_id, session_id),
  UNIQUE(epic_id, task_key)
);

-- Task key counter per board
CREATE TABLE IF NOT EXISTS kanban_task_key_counters (
  board_id INTEGER NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  next_number INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (board_id)
);

-- Indexes for epics
CREATE INDEX IF NOT EXISTS idx_epics_board ON kanban_epics(board_id);
CREATE INDEX IF NOT EXISTS idx_epics_status ON kanban_epics(status);
CREATE INDEX IF NOT EXISTS idx_epics_planner ON kanban_epics(planner_session_id);
CREATE INDEX IF NOT EXISTS idx_epic_sessions_epic ON kanban_epic_sessions(epic_id);
CREATE INDEX IF NOT EXISTS idx_epic_sessions_session ON kanban_epic_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_task_key_counters_board ON kanban_task_key_counters(board_id);

-- GitHub integration — per-board GitHub token and selected repos
CREATE TABLE IF NOT EXISTS kanban_github_configs (
  board_id INTEGER PRIMARY KEY REFERENCES kanban_boards(id) ON DELETE CASCADE,
  github_token TEXT NOT NULL,
  selected_repos TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_github_configs_board ON kanban_github_configs(board_id);

-- Linear integration — per-board Linear API key and selected teams
CREATE TABLE IF NOT EXISTS kanban_linear_configs (
  board_id INTEGER PRIMARY KEY REFERENCES kanban_boards(id) ON DELETE CASCADE,
  linear_api_key TEXT NOT NULL,
  selected_teams TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_linear_configs_board ON kanban_linear_configs(board_id);
