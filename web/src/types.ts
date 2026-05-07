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

export interface BoardFull {
  board: Board;
  columns: Column[];
  cards: Card[];
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
}

// ── Memory types ──────────────────────────────────────────────

export type MemoryType = 'context' | 'decision' | 'finding' | 'pattern' | 'error' | 'preference';
export type KnowledgeCategory = 'file' | 'command' | 'architecture' | 'api' | 'config' | 'schema' | 'workflow' | 'gotcha';

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
}

export interface KnowledgeEntry {
  id: number;
  category: KnowledgeCategory;
  key: string;
  title: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
  tags: string | null;
  indexed_by: string | null;
  indexed_at: string;
  access_count: number;
  importance: number;
}

// ── GitHub integration types ────────────────────────────────────

export interface GitHubConfig {
  board_id: number;
  has_token: boolean;
  token_masked: string;
  selected_repos: string[];
  created_at: string;
  updated_at: string;
}

export interface GitHubRepo {
  id: number;
  full_name: string;
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
  repository_url: string;
  pull_request?: { url: string };
}

export interface GitHubProject {
  id: string;
  number: number;
  title: string;
  short_description: string | null;
  public: boolean;
  closed: boolean;
  created_at: string;
  updated_at: string;
  url: string;
  owner: string;
  items_count: number;
}

export interface GitHubProjectItem {
  id: string;
  type: "ISSUE" | "PULL_REQUEST" | "DRAFT_ISSUE";
  title: string;
  body: string | null;
  state: string | null;
  html_url: string | null;
  number: number | null;
  repository: string | null;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  created_at: string;
  updated_at: string;
  status: string;
}
