export interface Board {
    id: number;
    name: string;
    repo_path: string;
    status: "active" | "archived";
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
export interface Card {
    session_id: string;
    title: string;
    description: string;
    directory: string;
    context_tokens: number;
    is_compacting: boolean;
    manually_completed: boolean;
    time_created: string;
    time_updated: string;
    column_name: string;
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
    status: "pending" | "dispatched" | "started" | "progress" | "completed" | "failed" | "escalated";
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
export interface GeneralSettings {
    auto_compact_enabled: boolean;
    auto_compact_threshold: number;
}
