#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { getOrCreateBoard, listBoards, reorderBoards, moveSessionToColumn, searchCards, createSubtask, updateSubtask, getSubtasks, addAgentLog, getAgentLogs, getDistinctRepos, getBoardFull, } from "./db.js";
import { saveMemory, searchMemories, searchMemoriesByVector, getMemories, updateMemory, compactConversationMemories, pruneMemories, getRepos, saveKnowledge, batchSaveKnowledge, searchKnowledge, getKnowledge, listKnowledge, getKnowledgeStats, getStaleKnowledge, deleteKnowledge, } from "./memories.js";
const VALID_CATEGORIES = ['file', 'command', 'architecture', 'api', 'config', 'schema', 'workflow', 'gotcha'];
const server = new Server({ name: "opencode-kanban", version: "1.0.0" }, { capabilities: { tools: {} } });
// ============================================================
// TOOL DEFINITIONS
// ============================================================
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        // ── Board tools ────────────────────────────────────────
        {
            name: "kanban_list_boards",
            description: "List all active kanban boards, optionally filtered by repository path.",
            inputSchema: {
                type: "object",
                properties: {
                    repo_path: {
                        type: "string",
                        description: "Optional repository path to filter boards",
                    },
                },
            },
        },
        {
            name: "kanban_get_board",
            description: "Get a complete board with all its columns, cards, subtasks, and sessions.",
            inputSchema: {
                type: "object",
                properties: {
                    board_id: { type: "number", description: "Board ID" },
                },
                required: ["board_id"],
            },
        },
        {
            name: "kanban_get_or_create_board",
            description: "Get an existing board for a repository or create one if it does not exist.",
            inputSchema: {
                type: "object",
                properties: {
                    repo_path: { type: "string", description: "Repository path" },
                },
                required: ["repo_path"],
            },
        },
        {
            name: "kanban_reorder_boards",
            description: "Reorder boards in the sidebar by position.",
            inputSchema: {
                type: "object",
                properties: {
                    board_ids: {
                        type: "array",
                        items: { type: "number" },
                        description: "Array of board IDs in the desired order",
                    },
                },
                required: ["board_ids"],
            },
        },
        // ── Session tools ────────────────────────────────────────
        {
            name: "kanban_move_card",
            description: "Move a card (session) to a different column.",
            inputSchema: {
                type: "object",
                properties: {
                    session_id: {
                        type: "string",
                        description: "Session ID (from opencode)",
                    },
                    to_column_name: { type: "string", description: "Target column name" },
                    board_id: { type: "number", description: "Board ID" },
                },
                required: ["session_id", "to_column_name", "board_id"],
            },
        },
        {
            name: "kanban_search_cards",
            description: "Search cards by title or description.",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query" },
                    board_id: { type: "number", description: "Board ID to limit search" },
                },
                required: ["query", "board_id"],
            },
        },
        // ── Subtask tools ────────────────────────────────────────
        {
            name: "kanban_create_subtask",
            description: "Create a subtask for a session assigned to an agent.",
            inputSchema: {
                type: "object",
                properties: {
                    session_id: { type: "string", description: "Session ID" },
                    agent_name: { type: "string", description: "Agent name" },
                    agent_type: {
                        type: "string",
                        enum: ["primary", "subagent"],
                        description: "Agent type",
                    },
                    title: { type: "string", description: "Optional subtask title" },
                    repository: {
                        type: "string",
                        description: "Optional repository path",
                    },
                    worktree: { type: "string", description: "Optional worktree name" },
                },
                required: ["session_id", "agent_name", "agent_type"],
            },
        },
        {
            name: "kanban_update_subtask",
            description: "Update subtask status, progress, details, or result.",
            inputSchema: {
                type: "object",
                properties: {
                    subtask_id: { type: "number", description: "Subtask ID" },
                    status: {
                        type: "string",
                        enum: [
                            "pending",
                            "dispatched",
                            "started",
                            "progress",
                            "completed",
                            "failed",
                            "escalated",
                        ],
                        description: "New status",
                    },
                    progress: {
                        type: "number",
                        description: "Progress percentage (0-100)",
                    },
                    details: { type: "string", description: "Work details" },
                    result_summary: { type: "string", description: "Result summary" },
                },
                required: ["subtask_id"],
            },
        },
        {
            name: "kanban_get_subtasks",
            description: "Get all subtasks for a session.",
            inputSchema: {
                type: "object",
                properties: {
                    session_id: { type: "string", description: "Session ID" },
                },
                required: ["session_id"],
            },
        },
        // ── Agent log tools ────────────────────────────────────────
        {
            name: "kanban_add_agent_log",
            description: "Log an agent action on a session.",
            inputSchema: {
                type: "object",
                properties: {
                    session_id: { type: "string", description: "Session ID" },
                    agent_name: { type: "string", description: "Agent name" },
                    agent_type: {
                        type: "string",
                        enum: ["primary", "subagent"],
                        description: "Agent type",
                    },
                    action: { type: "string", description: "Action description" },
                    details: { type: "string", description: "Optional action details" },
                    subtask_id: {
                        type: "number",
                        description: "Optional associated subtask ID",
                    },
                },
                required: ["session_id", "agent_name", "agent_type", "action"],
            },
        },
        {
            name: "kanban_get_agent_log",
            description: "Get all agent logs for a session.",
            inputSchema: {
                type: "object",
                properties: {
                    session_id: { type: "string", description: "Session ID" },
                },
                required: ["session_id"],
            },
        },
        // ── Repos tool ────────────────────────────────────────
        {
            name: "kanban_get_repos",
            description: "Get list of all distinct repositories with active boards.",
            inputSchema: {
                type: "object",
                properties: {},
            },
        },
        // ── Memory tools ────────────────────────────────────────
        {
            name: "memory_save",
            description: "Save a conversation memory — decisions, findings, patterns, errors, preferences. Persists context across sessions.",
            inputSchema: {
                type: "object",
                properties: {
                    repo_path: { type: "string", description: "Absolute path of the repository" },
                    conversation_id: { type: "string", description: "Current conversation identifier" },
                    agent_name: { type: "string", description: "Agent name (build, plan, debug-expert, etc.)" },
                    memory_type: { type: "string", enum: ["context", "decision", "finding", "pattern", "error", "preference"] },
                    content: { type: "string", description: "Full memory content (2-4 sentences)" },
                    summary: { type: "string", description: "One-line summary for quick scanning" },
                    tags: { type: "array", items: { type: "string" } },
                    importance: { type: "number", minimum: 0, maximum: 1 },
                },
                required: ["repo_path", "conversation_id", "agent_name", "memory_type", "content"],
            },
        },
        {
            name: "memory_search",
            description: "Full-text search across all past conversation memories.",
            inputSchema: {
                type: "object",
                properties: {
                    repo_path: { type: "string" },
                    query: { type: "string", description: "FTS5 search query" },
                    agent_name: { type: "string" },
                    memory_type: { type: "string", enum: ["context", "decision", "finding", "pattern", "error", "preference"] },
                    conversation_id: { type: "string" },
                    limit: { type: "number" },
                },
                required: ["repo_path", "query"],
            },
        },
        {
            name: "memory_get",
            description: "Get recent memories for a conversation or agent.",
            inputSchema: {
                type: "object",
                properties: {
                    repo_path: { type: "string" },
                    conversation_id: { type: "string" },
                    agent_name: { type: "string" },
                    limit: { type: "number" },
                    offset: { type: "number" },
                },
                required: ["repo_path"],
            },
        },
        {
            name: "memory_search_vector",
            description: "Semantic vector search across memories. Requires a 768-dim embedding.",
            inputSchema: {
                type: "object",
                properties: {
                    repo_path: { type: "string" },
                    embedding: { type: "array", items: { type: "number" }, description: "768-dimensional embedding vector" },
                    limit: { type: "number" },
                    threshold: { type: "number", description: "Max cosine distance (default 0.5)" },
                },
                required: ["repo_path", "embedding"],
            },
        },
        {
            name: "memory_update",
            description: "Update an existing memory.",
            inputSchema: {
                type: "object",
                properties: {
                    repo_path: { type: "string" },
                    id: { type: "number" },
                    content: { type: "string" },
                    summary: { type: "string" },
                    tags: { type: "array", items: { type: "string" } },
                    importance: { type: "number" },
                },
                required: ["repo_path", "id"],
            },
        },
        {
            name: "memory_compact",
            description: "Merge old memories in a conversation to save space.",
            inputSchema: {
                type: "object",
                properties: {
                    repo_path: { type: "string" },
                    conversation_id: { type: "string" },
                },
                required: ["repo_path", "conversation_id"],
            },
        },
        {
            name: "memory_prune",
            description: "Delete old low-importance memories.",
            inputSchema: {
                type: "object",
                properties: {
                    repo_path: { type: "string" },
                    keep_days: { type: "number" },
                    keep_important: { type: "boolean" },
                },
                required: ["repo_path"],
            },
        },
        {
            name: "memory_repos",
            description: "List all repositories with stored memories.",
            inputSchema: { type: "object", properties: {} },
        },
        // ── Knowledge Base tools ────────────────────────────────
        {
            name: "knowledge_save",
            description: `Save or update a knowledge entry. Categories:
- file: what a file does, its exports/imports (key = file path)
- command: CLI commands available (key = command name like "test", "build")
- architecture: system architecture, layers, patterns (key = area name)
- api: endpoints, their params, responses (key = "METHOD /path")
- config: env vars, setup, configuration (key = config area)
- schema: database tables, columns, relationships (key = table name)
- workflow: how to do common tasks (key = workflow name)
- gotcha: known pitfalls and workarounds (key = issue name)`,
            inputSchema: {
                type: "object",
                properties: {
                    repo_path: { type: "string" },
                    category: { type: "string", enum: VALID_CATEGORIES, description: "Knowledge category" },
                    key: { type: "string", description: "Unique identifier (file path, command name, etc.)" },
                    title: { type: "string", description: "Short human-readable title" },
                    content: { type: "string", description: "Detailed description" },
                    metadata: { type: "object", description: "Category-specific structured data (JSON)" },
                    tags: { type: "array", items: { type: "string" } },
                    indexed_by: { type: "string", description: "Agent that indexed this" },
                    importance: { type: "number", minimum: 0, maximum: 1 },
                },
                required: ["repo_path", "category", "key", "title"],
            },
        },
        {
            name: "knowledge_batch_save",
            description: "Batch save multiple knowledge entries in one transaction.",
            inputSchema: {
                type: "object",
                properties: {
                    repo_path: { type: "string" },
                    entries: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                category: { type: "string", enum: VALID_CATEGORIES },
                                key: { type: "string" },
                                title: { type: "string" },
                                content: { type: "string" },
                                metadata: { type: "object" },
                                tags: { type: "array", items: { type: "string" } },
                                importance: { type: "number" },
                            },
                            required: ["category", "key", "title"],
                        },
                        description: "Array of knowledge entries to save",
                    },
                    indexed_by: { type: "string" },
                },
                required: ["repo_path", "entries"],
            },
        },
        {
            name: "knowledge_search",
            description: "Search the knowledge base by text. Searches across keys, titles, content, and tags. Optionally filter by category.",
            inputSchema: {
                type: "object",
                properties: {
                    repo_path: { type: "string" },
                    query: { type: "string", description: "Search query" },
                    category: { type: "string", enum: VALID_CATEGORIES, description: "Filter by category (optional)" },
                    limit: { type: "number" },
                },
                required: ["repo_path", "query"],
            },
        },
        {
            name: "knowledge_get",
            description: "Get a specific knowledge entry by category and key.",
            inputSchema: {
                type: "object",
                properties: {
                    repo_path: { type: "string" },
                    category: { type: "string", enum: VALID_CATEGORIES },
                    key: { type: "string" },
                },
                required: ["repo_path", "category", "key"],
            },
        },
        {
            name: "knowledge_list",
            description: "List all knowledge entries for a repo. Optionally filter by category.",
            inputSchema: {
                type: "object",
                properties: {
                    repo_path: { type: "string" },
                    category: { type: "string", enum: VALID_CATEGORIES },
                    limit: { type: "number" },
                    offset: { type: "number" },
                },
                required: ["repo_path"],
            },
        },
        {
            name: "knowledge_stats",
            description: "Get knowledge base stats — total entries, count by category, most accessed.",
            inputSchema: {
                type: "object",
                properties: { repo_path: { type: "string" } },
                required: ["repo_path"],
            },
        },
        {
            name: "knowledge_stale",
            description: "Find knowledge entries that might be outdated (indexed long ago).",
            inputSchema: {
                type: "object",
                properties: {
                    repo_path: { type: "string" },
                    category: { type: "string", enum: VALID_CATEGORIES },
                    older_than_days: { type: "number" },
                    limit: { type: "number" },
                },
                required: ["repo_path"],
            },
        },
        {
            name: "knowledge_delete",
            description: "Delete a knowledge entry.",
            inputSchema: {
                type: "object",
                properties: {
                    repo_path: { type: "string" },
                    category: { type: "string", enum: VALID_CATEGORIES },
                    key: { type: "string" },
                },
                required: ["repo_path", "category", "key"],
            },
        },
    ],
}));
// ============================================================
// TOOL HANDLERS
// ============================================================
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const params = args;
    try {
        switch (name) {
            // ── Board tools ────────────────────────────────────────
            case "kanban_list_boards": {
                const boards = listBoards(params.repo_path);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ count: boards.length, boards }),
                        },
                    ],
                };
            }
            case "kanban_get_board": {
                const board = getBoardFull(params.board_id);
                return { content: [{ type: "text", text: JSON.stringify(board) }] };
            }
            case "kanban_get_or_create_board": {
                const board = getOrCreateBoard(params.repo_path);
                return { content: [{ type: "text", text: JSON.stringify(board) }] };
            }
            case "kanban_reorder_boards": {
                const boardIds = params.board_ids;
                if (!Array.isArray(boardIds)) {
                    return { content: [{ type: "text", text: "Error: board_ids must be an array" }] };
                }
                reorderBoards(boardIds);
                return {
                    content: [{ type: "text", text: JSON.stringify({ success: true }) }],
                };
            }
            // ── Session tools ────────────────────────────────────────
            case "kanban_move_card": {
                moveSessionToColumn(params.session_id, params.to_column_name, params.board_id);
                return {
                    content: [{ type: "text", text: JSON.stringify({ success: true }) }],
                };
            }
            case "kanban_search_cards": {
                const cards = searchCards(params.board_id, params.query);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ count: cards.length, cards }),
                        },
                    ],
                };
            }
            // ── Subtask tools ────────────────────────────────────────
            case "kanban_create_subtask": {
                const subtask = createSubtask(params.session_id, params.agent_name, params.agent_type, params.title || "", params.repository || "", params.worktree || "");
                return { content: [{ type: "text", text: JSON.stringify(subtask) }] };
            }
            case "kanban_update_subtask": {
                const subtask = updateSubtask(params.subtask_id, {
                    status: params.status,
                    progress: params.progress,
                    details: params.details,
                    result_summary: params.result_summary,
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(subtask || { error: "Subtask not found" }),
                        },
                    ],
                };
            }
            case "kanban_get_subtasks": {
                const subtasks = getSubtasks(params.session_id);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ count: subtasks.length, subtasks }),
                        },
                    ],
                };
            }
            // ── Agent log tools ────────────────────────────────────────
            case "kanban_add_agent_log": {
                const log = addAgentLog(params.session_id, params.agent_name, params.agent_type, params.action, params.details || "", params.subtask_id);
                return { content: [{ type: "text", text: JSON.stringify(log) }] };
            }
            case "kanban_get_agent_log": {
                const logs = getAgentLogs(params.session_id);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ count: logs.length, logs }),
                        },
                    ],
                };
            }
            // ── Repos tool ────────────────────────────────────────
            case "kanban_get_repos": {
                const repos = getDistinctRepos();
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ count: repos.length, repos }),
                        },
                    ],
                };
            }
            // ── Memory tools ────────────────────────────────────────
            case "memory_save": {
                const id = saveMemory(params.repo_path, {
                    conversationId: params.conversation_id,
                    agentName: params.agent_name,
                    memoryType: params.memory_type,
                    content: params.content,
                    summary: params.summary || null,
                    tags: params.tags || null,
                    importance: params.importance || 0.5,
                });
                return { content: [{ type: "text", text: JSON.stringify({ saved: true, id }) }] };
            }
            case "memory_search": {
                const results = searchMemories(params.repo_path, {
                    query: params.query,
                    agentName: params.agent_name,
                    memoryType: params.memory_type,
                    conversationId: params.conversation_id,
                    limit: params.limit || 20,
                });
                return { content: [{ type: "text", text: JSON.stringify({ count: results.length, memories: results }) }] };
            }
            case "memory_get": {
                const results = getMemories(params.repo_path, {
                    conversationId: params.conversation_id,
                    agentName: params.agent_name,
                    limit: params.limit || 50,
                    offset: params.offset || 0,
                });
                return { content: [{ type: "text", text: JSON.stringify({ count: results.length, memories: results }) }] };
            }
            case "memory_search_vector": {
                const embedding = params.embedding;
                if (!embedding || embedding.length !== 768) {
                    return { content: [{ type: "text", text: "Error: embedding must be a 768-dimensional array" }], isError: true };
                }
                const results = searchMemoriesByVector(params.repo_path, {
                    embedding,
                    limit: params.limit || 20,
                    threshold: params.threshold || 0.5,
                });
                return { content: [{ type: "text", text: JSON.stringify({ count: results.length, memories: results }) }] };
            }
            case "memory_update": {
                const updated = updateMemory(params.repo_path, params.id, {
                    content: params.content,
                    summary: params.summary,
                    tags: params.tags,
                    importance: params.importance,
                });
                return { content: [{ type: "text", text: JSON.stringify({ updated }) }] };
            }
            case "memory_compact": {
                const result = compactConversationMemories(params.repo_path, params.conversation_id);
                return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            case "memory_prune": {
                const removed = pruneMemories(params.repo_path, {
                    keepDays: params.keep_days || 90,
                    keepImportant: params.keep_important !== false,
                });
                return { content: [{ type: "text", text: JSON.stringify({ removed }) }] };
            }
            case "memory_repos": {
                const repos = getRepos();
                return { content: [{ type: "text", text: JSON.stringify({ count: repos.length, repos }) }] };
            }
            // ── Knowledge Base tools ────────────────────────────────
            case "knowledge_save": {
                saveKnowledge(params.repo_path, {
                    category: params.category,
                    key: params.key,
                    title: params.title,
                    content: params.content || null,
                    metadata: params.metadata || null,
                    tags: params.tags || null,
                    indexedBy: params.indexed_by || null,
                    importance: params.importance || 0.5,
                });
                return { content: [{ type: "text", text: JSON.stringify({ saved: true, category: params.category, key: params.key }) }] };
            }
            case "knowledge_batch_save": {
                const count = batchSaveKnowledge(params.repo_path, params.entries, params.indexed_by);
                return { content: [{ type: "text", text: JSON.stringify({ saved: count }) }] };
            }
            case "knowledge_search": {
                const results = searchKnowledge(params.repo_path, {
                    query: params.query,
                    category: params.category || undefined,
                });
                return { content: [{ type: "text", text: JSON.stringify({ count: results.length, entries: results }) }] };
            }
            case "knowledge_get": {
                const result = getKnowledge(params.repo_path, { category: params.category, key: params.key });
                return { content: [{ type: "text", text: JSON.stringify(result || { found: false }) }] };
            }
            case "knowledge_list": {
                const results = listKnowledge(params.repo_path, {
                    category: params.category || undefined,
                    limit: params.limit || 200,
                    offset: params.offset || 0,
                });
                return { content: [{ type: "text", text: JSON.stringify({ count: results.length, entries: results }) }] };
            }
            case "knowledge_stats": {
                const stats = getKnowledgeStats(params.repo_path);
                return { content: [{ type: "text", text: JSON.stringify(stats) }] };
            }
            case "knowledge_stale": {
                const results = getStaleKnowledge(params.repo_path, {
                    category: params.category || undefined,
                    olderThanDays: params.older_than_days || 7,
                    limit: params.limit || 100,
                });
                return { content: [{ type: "text", text: JSON.stringify({ count: results.length, entries: results }) }] };
            }
            case "knowledge_delete": {
                const deleted = deleteKnowledge(params.repo_path, { category: params.category, key: params.key });
                return { content: [{ type: "text", text: JSON.stringify({ deleted }) }] };
            }
            default:
                return {
                    content: [{ type: "text", text: `Unknown tool: ${name}` }],
                    isError: true,
                };
        }
    }
    catch (error) {
        console.error(`[kanban-server] Tool error in ${name}:`, error);
        return {
            content: [
                {
                    type: "text",
                    text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
});
async function main() {
    try {
        console.error("[kanban-server] Initializing MCP server...");
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("[kanban-server] Server connected and ready");
    }
    catch (error) {
        console.error("[kanban-server] Fatal error:", error);
        process.exit(1);
    }
}
main();
