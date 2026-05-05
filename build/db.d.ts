#!/usr/bin/env node
import Database from "better-sqlite3";
import type { Board, Column, Card, Subtask, AgentLog, BoardFull, Rule, Setting } from "./types.js";
export declare function getDb(): Database.Database;
export declare function getSessionFirstUserMessage(sessionId: string): string;
export declare function getSessionTokens(sessionId: string): number;
export declare function getSessionLatestAgent(sessionId: string): string | null;
export declare function getSessionExplicitColumn(sessionId: string): string | null;
export declare function setSessionExplicitColumn(sessionId: string, columnName: string): void;
export declare function getOrCreateBoard(repoPath: string): Board;
export declare function getBoard(boardId: number): Board | null;
export declare function listBoards(repoPath?: string): Board[];
export declare function archiveBoard(boardId: number): void;
export declare function listColumns(boardId: number): Column[];
export declare function getColumnByName(boardId: number, name: string): Column | null;
export declare function moveSessionToColumn(sessionId: string, toColumnName: string, boardId: number): void;
export declare function markSessionCompleted(sessionId: string): void;
export declare function unmarkSessionCompleted(sessionId: string): void;
export declare function searchCards(boardId: number, query: string): Card[];
export declare function createSubtask(sessionId: string, agentName: string, agentType: string, title?: string, repository?: string, worktree?: string): Subtask;
export declare function updateSubtask(subtaskId: number, data: {
    status?: string;
    progress?: number;
    details?: string;
    result_summary?: string;
}): Subtask | null;
export declare function getSubtasks(sessionId: string): Subtask[];
export declare function deleteSubtask(subtaskId: number): void;
export declare function addAgentLog(sessionId: string, agentName: string, agentType: string, action: string, details?: string, subtaskId?: number): AgentLog;
export declare function getAgentLogs(sessionId: string): AgentLog[];
export declare function getBoardFull(boardId: number): BoardFull;
interface ToolCall {
    tool: string;
    callID: string;
    status?: string;
    input?: unknown;
    output?: unknown;
}
interface SessionMessage {
    id: string;
    role: "user" | "assistant" | "system";
    model: string | null;
    agent: string | null;
    time_created: number;
    text: string;
    reasoning: string;
    tool_calls: ToolCall[];
    compactions: Array<{
        auto: boolean;
        tail_start_id: string;
    }>;
}
export interface SessionMessagesResponse {
    session_id: string;
    title: string | null;
    directory: string | null;
    model: string | null;
    total: number;
    context_tokens: number;
    messages: SessionMessage[];
}
export declare function getSessionMessages(sessionId: string, limit?: number, offset?: number): SessionMessagesResponse;
export declare function listRules(): Rule[];
export declare function createRule(title?: string, content?: string, enabled?: boolean): Rule;
export declare function updateRule(ruleId: number, data: {
    title?: string;
    content?: string;
    enabled?: boolean;
    position?: number;
}): Rule | null;
export declare function deleteRule(ruleId: number): boolean;
export declare function getEnabledRulesContent(): string;
export declare function getSetting(key: string): string | null;
export declare function setSetting(key: string, value: string): void;
export declare function getAllSettings(): Setting[];
export declare function getAutoCompactThreshold(): number;
export declare function isAutoCompactEnabled(): boolean;
export declare function getSessionModel(sessionId: string): string | null;
export declare function getActiveSessionIds(): Array<{
    id: string;
    directory: string;
}>;
export declare function getDistinctRepos(): string[];
export declare function closeDb(): void;
export {};
