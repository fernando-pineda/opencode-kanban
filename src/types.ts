export interface Board {
  id: number;
  name: string;
  repo_path: string;
  status: "active" | "archived";
  position: number;
  has_busy?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Column {
  id: number;
  board_id: number;
  name: string;
  position: number;
  created_at: string;
}

// Card is now a computed view over opencode session + kanban_completed
export interface Card {
  // From opencode session
  session_id: string;
  title: string;
  description: string;
  directory: string;
  context_tokens: number;
  is_compacting: boolean;
  is_busy?: boolean;
  manually_completed: boolean;
  time_created: string;
  time_updated: string;
  // Computed column placement
  column_name: string;
  // Populated by getBoardFull
  subtasks?: Subtask[];
  agent_logs?: AgentLog[];
}

export interface Subtask {
  id: number;
  session_id: string;
  agent_name: string;
  agent_type: "primary" | "subagent";
  title: string;
  repository: string;
  worktree: string;
  status:
    | "pending"
    | "dispatched"
    | "started"
    | "progress"
    | "completed"
    | "failed"
    | "escalated";
  progress: number;
  details: string;
  result_summary: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface AgentLog {
  id: number;
  session_id: string;
  subtask_id: number | null;
  agent_name: string;
  agent_type: "primary" | "subagent";
  action: string;
  details: string;
  timestamp: string;
}

export interface Epic {
  id: number;
  board_id: number;
  task_key: string;
  title: string;
  description: string;
  plan_text: string;
  status:
    | "planning"
    | "ready"
    | "spawning"
    | "running"
    | "completed"
    | "failed";
  planner_session_id: string | null;
  column_name: string;
  created_at: string;
  updated_at: string;
  sessions?: EpicSession[];
  plan_subtasks?: Array<{ title: string; description: string }>;
}

export interface EpicSession {
  id: number;
  epic_id: number;
  session_id: string;
  task_key: string;
  subtask_index: number;
  title: string;
  description: string;
  is_busy?: boolean;
}

export interface BoardFull {
  board: Board;
  columns: Column[];
  cards: Card[];
}

export interface Rule {
  id: number;
  title: string;
  content: string;
  position: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

// Typed settings keys with defaults
export interface GeneralSettings {
  memories_enabled: boolean;
  memories_auto_prune_days: number; // 1-365
  memories_keep_important: boolean;
}

// ── Memory types (memories.db) ──────────────────────────────

export type MemoryType =
  | "context"
  | "decision"
  | "finding"
  | "pattern"
  | "error"
  | "preference";

export type KnowledgeCategory =
  | "file"
  | "command"
  | "architecture"
  | "api"
  | "config"
  | "schema"
  | "workflow"
  | "gotcha";

export interface Memory {
  id: number;
  conversation_id: string;
  agent_name: string;
  memory_type: MemoryType;
  content: string;
  summary: string | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
  access_count: number;
  importance: number;
  _distance?: number; // populated by vector search
}

export interface KnowledgeEntry {
  id: number;
  category: KnowledgeCategory;
  key: string;
  title: string;
  content: string | null;
  metadata: Record<string, unknown> | string | null;
  tags: string | null;
  indexed_by: string | null;
  indexed_at: string;
  access_count: number;
  importance: number;
}

export interface MemorySearchOptions {
  query: string;
  limit?: number;
  agentName?: string;
  memoryType?: MemoryType;
  conversationId?: string;
}

export interface KnowledgeSearchOptions {
  query: string;
  category?: KnowledgeCategory;
  limit?: number;
}

export interface MemoriesStats {
  memory_count: number;
  knowledge_count: number;
  by_type: Array<{ memory_type: string; count: number }>;
  by_agent: Array<{ agent_name: string; count: number }>;
}

export interface KnowledgeStats {
  total: number;
  by_category: Array<{ category: string; count: number }>;
  top_accessed: Array<{
    category: string;
    key: string;
    title: string;
    access_count: number;
  }>;
}

export interface KnowledgeListOptions {
  category?: KnowledgeCategory;
  limit?: number;
  offset?: number;
}

export interface MemoryListOptions {
  conversationId?: string;
  agentName?: string;
  limit?: number;
  offset?: number;
}

export interface MemorySaveOptions {
  conversationId: string;
  agentName: string;
  memoryType: MemoryType;
  content: string;
  summary?: string | null;
  tags?: string[] | null;
  importance?: number;
}

export interface KnowledgeSaveOptions {
  category: KnowledgeCategory;
  key: string;
  title: string;
  content?: string | null;
  metadata?: Record<string, unknown> | null;
  tags?: string[] | null;
  indexedBy?: string | null;
  importance?: number;
}

// ── GitHub integration types ────────────────────────────────────

export interface GitHubConfig {
  board_id: number;
  has_token: boolean;
  token_masked: string; // e.g. "ghp_****abcd"
  selected_repos: string[]; // e.g. ["owner/repo", ...]
  selected_projects: string[]; // array of project IDs (GraphQL node IDs)
  created_at: string;
  updated_at: string;
}

export interface GitHubRepo {
  id: number;
  full_name: string; // "owner/repo"
  name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  language: string | null;
  open_issues_count: number;
  updated_at: string;
}

export interface GitHubLabel {
  id: number;
  name: string;
  color: string;
  description: string | null;
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
  html_url: string;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  user: GitHubUser;
  comments: number;
  created_at: string;
  updated_at: string;
  repository_url: string; // "https://api.github.com/repos/owner/repo"
  pull_request?: { url: string }; // present if issue is actually a PR
}

export interface GitHubProject {
  id: string; // GraphQL node ID
  number: number; // project number
  title: string;
  short_description: string | null;
  public: boolean;
  closed: boolean;
  created_at: string;
  updated_at: string;
  url: string; // web URL
  owner: string; // org or user login
  items_count: number;
}

export interface GitHubProjectItem {
  id: string; // GraphQL node ID
  type: "ISSUE" | "PULL_REQUEST" | "DRAFT_ISSUE";
  title: string;
  body: string | null;
  state: string | null; // issue/PR state
  html_url: string | null;
  number: number | null;
  repository: string | null; // "owner/repo"
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  created_at: string;
  updated_at: string;
  status: string; // project item status field value
}

// ── Linear integration types ────────────────────────────────────

export interface LinearConfig {
  board_id: number;
  has_token: boolean;
  token_masked: string; // e.g. "lin_api_****abcd"
  selected_teams: string[]; // array of team UUIDs
  created_at: string;
  updated_at: string;
}

export interface LinearTeam {
  id: string; // UUID
  key: string; // e.g. "ENG" — used in issue identifiers
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LinearWorkflowState {
  id: string;
  name: string;
  type:
    | "triage"
    | "backlog"
    | "unstarted"
    | "started"
    | "completed"
    | "canceled";
  color: string;
}

export interface LinearUser {
  id: string;
  name: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
}

export interface LinearLabel {
  id: string;
  name: string;
  color: string;
}

export interface LinearIssue {
  id: string; // UUID
  identifier: string; // e.g. "ENG-123"
  number: number;
  title: string;
  description: string | null; // markdown
  priority: number; // 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
  priority_label: string;
  url: string;
  branch_name: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  canceled_at: string | null;
  due_date: string | null;
  estimate: number | null;
  state: LinearWorkflowState;
  assignee: LinearUser | null;
  labels: LinearLabel[];
  team: {
    id: string;
    key: string;
    name: string;
  };
  parent: { id: string; identifier: string; title: string } | null;
  project: { id: string; name: string } | null;
}
