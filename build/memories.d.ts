import Database from 'better-sqlite3';
import type { Memory, KnowledgeEntry, MemorySearchOptions, KnowledgeSearchOptions, KnowledgeStats, MemorySaveOptions, KnowledgeSaveOptions } from './types.js';
/**
 * Get or initialize the database connection (singleton).
 */
export declare function getDb(): Database.Database;
/**
 * Convert a repository path to a table name.
 * Takes last 2 path segments, replaces non-alphanumeric with underscore, lowercases.
 * Example: /Users/fernando/opencode-kanban -> repo_fernando_opencode_kanban
 */
export declare function repoToTableName(repoPath: string): string;
/**
 * Ensure repo-specific tables exist. Creates memories and knowledge tables if they don't exist.
 * Returns the table name.
 */
export declare function ensureRepoTable(repoPath: string): string;
/**
 * Save a memory entry to the database.
 * Returns the last inserted row ID.
 */
export declare function saveMemory(repoPath: string, { conversationId, agentName, memoryType, content, summary, tags, importance, }: MemorySaveOptions): number;
/**
 * Save a memory entry with a 768-dim vector embedding.
 * Returns the memory ID.
 */
export declare function saveMemoryWithEmbedding(repoPath: string, { conversationId, agentName, memoryType, content, summary, tags, importance, embedding, }: MemorySaveOptions & {
    embedding: Float32Array | number[];
}): number;
/**
 * Search memories by full-text query.
 * Supports filtering by agentName, memoryType, and conversationId.
 */
export declare function searchMemories(repoPath: string, { query, limit, agentName, memoryType, conversationId, }?: MemorySearchOptions & {
    limit?: number;
    agentName?: string;
    memoryType?: string;
    conversationId?: string;
}): Memory[];
/**
 * Search memories by vector embedding distance.
 * Returns memories within the threshold distance.
 */
export declare function searchMemoriesByVector(repoPath: string, { embedding, limit, threshold, }: {
    embedding: Float32Array | number[];
    limit?: number;
    threshold?: number;
}): Memory[];
/**
 * Get paginated list of memories, optionally filtered by conversationId or agentName.
 */
export declare function getMemories(repoPath: string, { conversationId, agentName, memoryType, limit, offset, }?: {
    conversationId?: string;
    agentName?: string;
    memoryType?: string;
    limit?: number;
    offset?: number;
}): Memory[];
/**
 * Get memory statistics for a repository.
 */
export declare function getMemoriesStats(repoPath: string): {
    total: number;
    by_type: Array<{
        memory_type: string;
        count: number;
    }>;
};
/**
 * Get total count of memories for pagination.
 */
export declare function getMemoriesCount(repoPath: string, { memoryType }?: {
    memoryType?: string;
}): number;
/**
 * Get all repositories tracked in the _meta table.
 */
export declare function getRepos(): Array<{
    repo_id: string;
    repo_path: string;
    created_at: string;
    last_accessed: string;
}>;
/**
 * Prune old, low-importance memories from a repository.
 * Returns the count of deleted memories.
 */
export declare function pruneMemories(repoPath: string, { keepDays, keepImportant }?: {
    keepDays?: number;
    keepImportant?: boolean;
}): number;
/**
 * Update a memory entry (content, summary, tags, importance).
 * Returns true if the update succeeded.
 */
export declare function updateMemory(repoPath: string, id: number, { content, summary, tags, importance, }?: {
    content?: string;
    summary?: string;
    tags?: string[];
    importance?: number;
}): boolean;
/**
 * Compact conversation memories by merging older memories.
 * Returns { original, compacted, removed }.
 */
export declare function compactConversationMemories(repoPath: string, conversationId: string): {
    original: number;
    compacted: number;
    removed: number;
};
/**
 * Save or update a knowledge entry (upsert by category + key).
 * Returns true if successful.
 */
export declare function saveKnowledge(repoPath: string, { category, key, title, content, metadata, tags, indexedBy, importance, }: KnowledgeSaveOptions): boolean;
/**
 * Batch save knowledge entries in a single transaction.
 * Returns the count of entries saved.
 */
export declare function batchSaveKnowledge(repoPath: string, entries: KnowledgeSaveOptions[], indexedBy?: string): number;
/**
 * Search knowledge entries by text across key, title, content, and tags.
 * Bumps access_count for matched entries.
 */
export declare function searchKnowledge(repoPath: string, { query, category, limit, }?: KnowledgeSearchOptions & {
    limit?: number;
}): KnowledgeEntry[];
/**
 * Get a specific knowledge entry by category + key.
 * Bumps access_count.
 */
export declare function getKnowledge(repoPath: string, { category, key }: {
    category: string;
    key: string;
}): KnowledgeEntry | undefined;
/**
 * List knowledge entries, optionally filtered by category.
 */
export declare function listKnowledge(repoPath: string, { category, limit, offset, }?: {
    category?: string;
    limit?: number;
    offset?: number;
}): KnowledgeEntry[];
/**
 * Get knowledge statistics for a repository.
 */
export declare function getKnowledgeStats(repoPath: string): KnowledgeStats;
/**
 * Find knowledge entries that are potentially stale (older than N days).
 */
export declare function getStaleKnowledge(repoPath: string, { olderThanDays, category, limit, }?: {
    olderThanDays?: number;
    category?: string;
    limit?: number;
}): KnowledgeEntry[];
/**
 * Delete a knowledge entry by category + key.
 * Returns true if the deletion succeeded.
 */
export declare function deleteKnowledge(repoPath: string, { category, key }: {
    category: string;
    key: string;
}): boolean;
