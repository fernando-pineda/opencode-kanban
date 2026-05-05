#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  getOrCreateBoard,
  getBoard,
  listBoards,
  archiveBoard,
  moveSessionToColumn,
  searchCards,
  createSubtask,
  updateSubtask,
  getSubtasks,
  deleteSubtask,
  addAgentLog,
  getAgentLogs,
  getDistinctRepos,
  getBoardFull,
  markSessionCompleted,
  unmarkSessionCompleted,
} from "./db.js";

const server = new Server(
  { name: "opencode-kanban", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// ============================================================
// TOOL DEFINITIONS
// ============================================================

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ── Board tools ────────────────────────────────────────
    {
      name: "kanban_list_boards",
      description:
        "List all active kanban boards, optionally filtered by repository path.",
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
      description:
        "Get a complete board with all its columns, cards, subtasks, and sessions.",
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
      description:
        "Get an existing board for a repository or create one if it does not exist.",
      inputSchema: {
        type: "object",
        properties: {
          repo_path: { type: "string", description: "Repository path" },
        },
        required: ["repo_path"],
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
  ],
}));

// ============================================================
// TOOL HANDLERS
// ============================================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const params = args as Record<string, unknown>;

  try {
    switch (name) {
      // ── Board tools ────────────────────────────────────────
      case "kanban_list_boards": {
        const boards = listBoards(params.repo_path as string | undefined);
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
        const board = getBoardFull(params.board_id as number);
        return { content: [{ type: "text", text: JSON.stringify(board) }] };
      }

      case "kanban_get_or_create_board": {
        const board = getOrCreateBoard(params.repo_path as string);
        return { content: [{ type: "text", text: JSON.stringify(board) }] };
      }

      // ── Session tools ────────────────────────────────────────
      case "kanban_move_card": {
        moveSessionToColumn(
          params.session_id as string,
          params.to_column_name as string,
          params.board_id as number,
        );
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true }) }],
        };
      }

      case "kanban_search_cards": {
        const cards = searchCards(
          params.board_id as number,
          params.query as string,
        );
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
        const subtask = createSubtask(
          params.session_id as string,
          params.agent_name as string,
          params.agent_type as string,
          (params.title as string) || "",
          (params.repository as string) || "",
          (params.worktree as string) || "",
        );
        return { content: [{ type: "text", text: JSON.stringify(subtask) }] };
      }

      case "kanban_update_subtask": {
        const subtask = updateSubtask(params.subtask_id as number, {
          status: params.status as string | undefined,
          progress: params.progress as number | undefined,
          details: params.details as string | undefined,
          result_summary: params.result_summary as string | undefined,
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
        const subtasks = getSubtasks(params.session_id as string);
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
        const log = addAgentLog(
          params.session_id as string,
          params.agent_name as string,
          params.agent_type as string,
          params.action as string,
          (params.details as string) || "",
          params.subtask_id as number | undefined,
        );
        return { content: [{ type: "text", text: JSON.stringify(log) }] };
      }

      case "kanban_get_agent_log": {
        const logs = getAgentLogs(params.session_id as string);
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

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
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
  } catch (error) {
    console.error("[kanban-server] Fatal error:", error);
    process.exit(1);
  }
}

main();
