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
  selected_projects: string[];
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

// ── Linear integration types ─────────────────────────────────────

export interface LinearConfig {
  board_id: number;
  has_token: boolean;
  token_masked: string;
  selected_teams: string[];
  created_at: string;
  updated_at: string;
}

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
}

export interface LinearLabel {
  id: string;
  name: string;
  color: string;
}

export interface LinearUser {
  id: string;
  name: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface LinearState {
  id: string;
  name: string;
  color: string;
  type: string;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  priority: number;
  priority_label: string;
  state: LinearState;
  labels: LinearLabel[];
  assignee: LinearUser | null;
  team: LinearTeam;
  teamId: string;
  project: { name: string } | null;
  branch_name: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

// ── JIRA integration types ────────────────────────────────────

export interface JiraConfig {
  board_id: number;
  has_token: boolean;
  token_masked: string;
  base_url: string;
  email: string;
  selected_projects: string[];
  created_at: string;
  updated_at: string;
}

export interface JiraProject {
  key: string;
  name: string;
  projectTypeKey: string;
  style: string;
  avatarUrls: Record<string, string>;
}

export interface JiraStatus {
  name: string;
  statusCategory: {
    key: string;
    colorName: string;
    name: string;
  };
}

export interface JiraPriority {
  id: string;
  name: string;
  iconUrl: string;
}

export interface JiraIssueType {
  id: string;
  name: string;
  iconUrl: string;
  subtask: boolean;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls: Record<string, string>;
}

export interface JiraIssue {
  key: string;
  html_url: string;
  fields: {
    summary: string;
    description: string | null; // already converted to plain text by backend
    status: JiraStatus;
    priority: JiraPriority | null;
    issuetype: JiraIssueType;
    assignee: JiraUser | null;
    reporter: JiraUser | null;
    labels: string[];
    project: { key: string; name: string };
    created: string;
    updated: string;
  };
}

// ── File Indexing types ──────────────────────────────────────

export interface FileIndexingStatus {
  board_id: number;
  status: 'idle' | 'indexing' | 'watching' | 'error';
  status_message: string;
  total_files: number;
  total_chunks: number;
  total_bytes: number;
  last_full_index: string | null;
  ollama_model: string;
  is_watching: boolean;
}

export interface FileSearchResult {
  file_path: string;
  line_start: number;
  line_end: number;
  content: string;
  score: number;
}

export interface OllamaCheckResult {
  ok: boolean;
  models: string[];
  error?: string;
}

export interface FileIndexingProgress {
  board_id: number;
  indexed: number;
  total: number;
  current_file: string;
  status: 'indexing' | 'watching' | 'idle' | 'error';
}
