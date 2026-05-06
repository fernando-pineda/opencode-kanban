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
export interface Card {
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
    column_name: string;
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
export interface Epic {
    id: number;
    board_id: number;
    task_key: string;
    title: string;
    description: string;
    plan_text: string;
    status: "planning" | "ready" | "spawning" | "running" | "completed" | "failed";
    planner_session_id: string | null;
    column_name: string;
    created_at: string;
    updated_at: string;
    sessions?: EpicSession[];
    plan_subtasks?: Array<{
        title: string;
        description: string;
    }>;
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
    epics: Epic[];
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
export interface Notification {
    id: number;
    board_id: number;
    session_id: string;
    type: 'iteration_complete' | 'epic_complete' | 'task_failed' | 'subtask_complete';
    title: string;
    seen: boolean;
    created_at: string;
    updated_at: string;
}
export interface GeneralSettings {
    auto_compact_enabled: boolean;
    auto_compact_threshold: number;
    memories_enabled: boolean;
    memories_auto_prune_days: number;
    memories_keep_important: boolean;
}
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
    _distance?: number;
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
    by_type: Array<{
        memory_type: string;
        count: number;
    }>;
    by_agent: Array<{
        agent_name: string;
        count: number;
    }>;
}
export interface KnowledgeStats {
    total: number;
    by_category: Array<{
        category: string;
        count: number;
    }>;
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
