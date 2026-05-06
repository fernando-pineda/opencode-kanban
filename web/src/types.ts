export interface Board {
  id: number;
  name: string;
  repo_path: string;
  status: "active" | "archived";
  position: number;
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
  epic_task_key?: string;
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

export interface SwarmSubtask {
  title: string;
  description: string;
}

export interface BoardFull {
  board: Board;
  columns: Column[];
  cards: Card[];
  epics: Epic[];
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
