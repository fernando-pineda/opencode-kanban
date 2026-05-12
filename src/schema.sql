-- Cleanup: drop deprecated subtask and agent_log tables
DROP TABLE IF EXISTS kanban_agent_logs;
DROP TABLE IF EXISTS kanban_subtasks;

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

-- Indexes
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

-- JIRA integration — per-board JIRA Cloud config and selected projects
CREATE TABLE IF NOT EXISTS kanban_jira_configs (
  board_id INTEGER PRIMARY KEY REFERENCES kanban_boards(id) ON DELETE CASCADE,
  jira_base_url TEXT NOT NULL,
  jira_email TEXT NOT NULL,
  jira_api_token TEXT NOT NULL,
  selected_projects TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jira_configs_board ON kanban_jira_configs(board_id);

-- File indexing — embedded source code chunks with vector search
CREATE TABLE IF NOT EXISTS kanban_file_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  content TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(board_id, file_path, line_start)
);

CREATE INDEX IF NOT EXISTS idx_file_index_board ON kanban_file_index(board_id);
CREATE INDEX IF NOT EXISTS idx_file_index_path ON kanban_file_index(board_id, file_path);
CREATE INDEX IF NOT EXISTS idx_file_index_hash ON kanban_file_index(board_id, file_path, content_hash);

-- File indexing metadata per board
CREATE TABLE IF NOT EXISTS kanban_file_index_meta (
  board_id INTEGER PRIMARY KEY REFERENCES kanban_boards(id) ON DELETE CASCADE,
  total_files INTEGER NOT NULL DEFAULT 0,
  total_chunks INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK(status IN ('idle', 'indexing', 'watching', 'error')),
  status_message TEXT DEFAULT '',
  last_full_index TEXT DEFAULT NULL,
  ollama_model TEXT NOT NULL DEFAULT 'nomic-embed-text',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Settings keys for file indexing (stored in kanban_settings table, NOT a new table):
-- file_indexing_enabled = 'true'
-- file_indexing_aws_profile = 'default'
-- file_indexing_aws_region = 'us-east-1'
-- file_indexing_embedding_model = 'amazon.titan-embed-text-v2:0'
-- file_indexing_embedding_dimensions = '1024'
-- file_indexing_max_file_size = '1048576'
-- file_indexing_chunk_size = '2000'
-- file_indexing_chunk_overlap = '200'
-- file_indexing_top_k = '5'
