import Database from 'better-sqlite3';
import { createRequire } from 'module';
import { homedir } from 'os';
import { join } from 'path';
const require = createRequire(import.meta.url);
const sqliteVec = require('sqlite-vec');
const DB_PATH = process.env.OPENCODE_MEMORIES_DB_PATH ||
    join(homedir(), '.local', 'share', 'opencode', 'memories.db');
let db = null;
/**
 * Get or initialize the database connection (singleton).
 */
export function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.loadExtension(sqliteVec.getLoadablePath());
        ensureMetaTable(db);
    }
    return db;
}
/**
 * Ensure the _meta table exists to track repositories.
 */
function ensureMetaTable(database) {
    database.exec(`
    CREATE TABLE IF NOT EXISTS _meta (
      repo_id TEXT PRIMARY KEY,
      repo_path TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      last_accessed TEXT DEFAULT (datetime('now'))
    )
  `);
}
/**
 * Convert a repository path to a table name.
 * Takes last 2 path segments, replaces non-alphanumeric with underscore, lowercases.
 * Example: /Users/fernando/opencode-kanban -> repo_fernando_opencode_kanban
 */
export function repoToTableName(repoPath) {
    const parts = repoPath.replace(/\\/g, '/').split('/').filter(Boolean);
    const name = parts
        .slice(-2)
        .join('_')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .toLowerCase();
    return `repo_${name}`;
}
/**
 * Ensure repo-specific tables exist. Creates memories and knowledge tables if they don't exist.
 * Returns the table name.
 */
export function ensureRepoTable(repoPath) {
    const database = getDb();
    const tableName = repoToTableName(repoPath);
    // Track in _meta
    database
        .prepare(`
    INSERT INTO _meta (repo_id, repo_path, last_accessed) VALUES (?, ?, datetime('now'))
    ON CONFLICT(repo_id) DO UPDATE SET last_accessed = datetime('now')
  `)
        .run(tableName, repoPath);
    const tableExists = database
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(tableName);
    if (!tableExists) {
        // === CONVERSATION MEMORIES ===
        database.exec(`
      CREATE TABLE ${tableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        memory_type TEXT NOT NULL CHECK(memory_type IN ('context', 'decision', 'finding', 'pattern', 'error', 'preference')),
        content TEXT NOT NULL,
        summary TEXT,
        tags TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        access_count INTEGER DEFAULT 0,
        importance REAL DEFAULT 0.5
      )
    `);
        // FTS5 virtual table for memory search
        database.exec(`
      CREATE VIRTUAL TABLE ${tableName}_fts USING fts5(
        content, summary, tags, agent_name,
        content='${tableName}', content_rowid='id'
      )
    `);
        // Vec0 virtual table for 768-dim embeddings
        database.exec(`
      CREATE VIRTUAL TABLE ${tableName}_vec USING vec0(embedding float[768])
    `);
        // Mapping table for memory_id to vec_rowid
        database.exec(`
      CREATE TABLE ${tableName}_vec_map (
        memory_id INTEGER PRIMARY KEY REFERENCES ${tableName}(id) ON DELETE CASCADE,
        vec_rowid INTEGER NOT NULL
      )
    `);
        // Triggers for memory FTS synchronization
        database.exec(`
      CREATE TRIGGER ${tableName}_ai AFTER INSERT ON ${tableName} BEGIN
        INSERT INTO ${tableName}_fts(rowid, content, summary, tags, agent_name)
        VALUES (new.id, new.content, new.summary, new.tags, new.agent_name);
      END;
      CREATE TRIGGER ${tableName}_ad AFTER DELETE ON ${tableName} BEGIN
        INSERT INTO ${tableName}_fts(${tableName}_fts, rowid, content, summary, tags, agent_name)
        VALUES ('delete', old.id, old.content, old.summary, old.tags, old.agent_name);
      END;
      CREATE TRIGGER ${tableName}_au AFTER UPDATE ON ${tableName} BEGIN
        INSERT INTO ${tableName}_fts(${tableName}_fts, rowid, content, summary, tags, agent_name)
        VALUES ('delete', old.id, old.content, old.summary, old.tags, old.agent_name);
        INSERT INTO ${tableName}_fts(rowid, content, summary, tags, agent_name)
        VALUES (new.id, new.content, new.summary, new.tags, new.agent_name);
      END;
    `);
        // Indexes on memory table
        database.exec(`
      CREATE INDEX idx_${tableName}_conv ON ${tableName}(conversation_id);
      CREATE INDEX idx_${tableName}_agent ON ${tableName}(agent_name);
      CREATE INDEX idx_${tableName}_type ON ${tableName}(memory_type);
      CREATE INDEX idx_${tableName}_time ON ${tableName}(created_at);
    `);
        // === UNIFIED KNOWLEDGE BASE ===
        // Persistent codebase knowledge organized by category
        const knName = `${tableName}_knowledge`;
        database.exec(`
      CREATE TABLE ${knName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL CHECK(category IN ('file', 'command', 'architecture', 'api', 'config', 'schema', 'workflow', 'gotcha')),
        key TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        metadata TEXT,
        tags TEXT,
        indexed_by TEXT,
        indexed_at TEXT DEFAULT (datetime('now')),
        access_count INTEGER DEFAULT 0,
        importance REAL DEFAULT 0.5,
        UNIQUE(category, key)
      )
    `);
        // FTS5 for knowledge search
        database.exec(`
      CREATE VIRTUAL TABLE ${knName}_fts USING fts5(
        key, title, content, tags,
        content='${knName}', content_rowid='id'
      )
    `);
        // Triggers for knowledge FTS synchronization
        database.exec(`
      CREATE TRIGGER ${knName}_ai AFTER INSERT ON ${knName} BEGIN
        INSERT INTO ${knName}_fts(rowid, key, title, content, tags)
        VALUES (new.id, new.key, new.title, new.content, new.tags);
      END;
      CREATE TRIGGER ${knName}_ad AFTER DELETE ON ${knName} BEGIN
        INSERT INTO ${knName}_fts(${knName}_fts, rowid, key, title, content, tags)
        VALUES ('delete', old.id, old.key, old.title, old.content, old.tags);
      END;
      CREATE TRIGGER ${knName}_au AFTER UPDATE ON ${knName} BEGIN
        INSERT INTO ${knName}_fts(${knName}_fts, rowid, key, title, content, tags)
        VALUES ('delete', old.id, old.key, old.title, old.content, old.tags);
        INSERT INTO ${knName}_fts(rowid, key, title, content, tags)
        VALUES (new.id, new.key, new.title, new.content, new.tags);
      END;
    `);
        // Indexes on knowledge table
        database.exec(`
      CREATE INDEX idx_${knName}_cat ON ${knName}(category);
      CREATE INDEX idx_${knName}_key ON ${knName}(key);
      CREATE INDEX idx_${knName}_time ON ${knName}(indexed_at);
    `);
    }
    return tableName;
}
/**
 * Sanitize FTS5 query by wrapping hyphenated words in quotes.
 * Example: react-native -> "react-native"
 */
function sanitizeFts5Query(query) {
    return query.replace(/(\S+-\S+)/g, '"$1"');
}
// ============================================================
// CONVERSATION MEMORIES
// ============================================================
/**
 * Save a memory entry to the database.
 * Returns the last inserted row ID.
 */
export function saveMemory(repoPath, { conversationId, agentName, memoryType, content, summary, tags, importance = 0.5, }) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    const result = database
        .prepare(`
    INSERT INTO ${tableName} (conversation_id, agent_name, memory_type, content, summary, tags, importance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
        .run(conversationId, agentName, memoryType, content, summary || null, tags ? tags.join(',') : null, importance);
    return Number(result.lastInsertRowid);
}
/**
 * Save a memory entry with a 768-dim vector embedding.
 * Returns the memory ID.
 */
export function saveMemoryWithEmbedding(repoPath, { conversationId, agentName, memoryType, content, summary, tags, importance = 0.5, embedding, }) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    const vecName = `${tableName}_vec`;
    const vecMapName = `${tableName}_vec_map`;
    const result = database
        .prepare(`
    INSERT INTO ${tableName} (conversation_id, agent_name, memory_type, content, summary, tags, importance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
        .run(conversationId, agentName, memoryType, content, summary || null, tags ? tags.join(',') : null, importance);
    const memoryId = Number(result.lastInsertRowid);
    if (embedding && embedding.length === 768) {
        const float32 = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
        const buf = Buffer.from(float32.buffer);
        const vecResult = database
            .prepare(`INSERT INTO ${vecName}(embedding) VALUES (?)`)
            .run(buf);
        database
            .prepare(`INSERT INTO ${vecMapName} (memory_id, vec_rowid) VALUES (?, ?)`)
            .run(memoryId, Number(vecResult.lastInsertRowid));
    }
    return memoryId;
}
/**
 * Search memories by full-text query.
 * Supports filtering by agentName, memoryType, and conversationId.
 */
export function searchMemories(repoPath, { query, limit = 20, agentName, memoryType, conversationId, } = {
    query: '',
}) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    const ftsName = `${tableName}_fts`;
    const safeQuery = sanitizeFts5Query(query);
    let sql = `SELECT m.* FROM ${tableName} m JOIN ${ftsName} fts ON m.id = fts.rowid WHERE ${ftsName} MATCH ?`;
    const params = [safeQuery];
    if (agentName) {
        sql += ` AND m.agent_name = ?`;
        params.push(agentName);
    }
    if (memoryType) {
        sql += ` AND m.memory_type = ?`;
        params.push(memoryType);
    }
    if (conversationId) {
        sql += ` AND m.conversation_id = ?`;
        params.push(conversationId);
    }
    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);
    return database.prepare(sql).all(...params);
}
/**
 * Search memories by vector embedding distance.
 * Returns memories within the threshold distance.
 */
export function searchMemoriesByVector(repoPath, { embedding, limit = 20, threshold = 0.5, }) {
    if (!embedding || embedding.length !== 768) {
        return [];
    }
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    const vecName = `${tableName}_vec`;
    const vecMapName = `${tableName}_vec_map`;
    const float32 = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
    const buf = Buffer.from(float32.buffer);
    const vecRows = database
        .prepare(`SELECT rowid, distance FROM ${vecName} WHERE embedding MATCH ? AND k = ? ORDER BY distance`)
        .all(buf, limit);
    const results = [];
    for (const vecRow of vecRows) {
        if (vecRow.distance <= threshold) {
            const mapping = database
                .prepare(`SELECT memory_id FROM ${vecMapName} WHERE vec_rowid = ?`)
                .get(vecRow.rowid);
            if (mapping) {
                const memory = database.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(mapping.memory_id);
                if (memory) {
                    memory._distance = vecRow.distance;
                    results.push(memory);
                }
            }
        }
    }
    return results;
}
/**
 * Get paginated list of memories, optionally filtered by conversationId or agentName.
 */
export function getMemories(repoPath, { conversationId, agentName, memoryType, limit = 50, offset = 0, } = {}) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    let sql = `SELECT * FROM ${tableName} WHERE 1=1`;
    const params = [];
    if (conversationId) {
        sql += ` AND conversation_id = ?`;
        params.push(conversationId);
    }
    if (agentName) {
        sql += ` AND agent_name = ?`;
        params.push(agentName);
    }
    if (memoryType) {
        sql += ` AND memory_type = ?`;
        params.push(memoryType);
    }
    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    return database.prepare(sql).all(...params);
}
/**
 * Get memory statistics for a repository.
 */
export function getMemoriesStats(repoPath) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    const total = database
        .prepare(`SELECT COUNT(*) as count FROM ${tableName}`)
        .get();
    const byType = database
        .prepare(`SELECT memory_type, COUNT(*) as count FROM ${tableName} GROUP BY memory_type ORDER BY count DESC`)
        .all();
    return {
        total: total.count,
        by_type: byType,
    };
}
/**
 * Get total count of memories for pagination.
 */
export function getMemoriesCount(repoPath, { memoryType } = {}) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    let sql = `SELECT COUNT(*) as count FROM ${tableName} WHERE 1=1`;
    const params = [];
    if (memoryType) {
        sql += ` AND memory_type = ?`;
        params.push(memoryType);
    }
    return database.prepare(sql).get(...params).count;
}
/**
 * Get all repositories tracked in the _meta table.
 */
export function getRepos() {
    return getDb()
        .prepare('SELECT * FROM _meta ORDER BY last_accessed DESC')
        .all();
}
/**
 * Prune old, low-importance memories from a repository.
 * Returns the count of deleted memories.
 */
export function pruneMemories(repoPath, { keepDays = 90, keepImportant = true } = {}) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    const sql = keepImportant
        ? `DELETE FROM ${tableName} WHERE created_at < datetime('now', '-${keepDays} days') AND importance < 0.8`
        : `DELETE FROM ${tableName} WHERE created_at < datetime('now', '-${keepDays} days')`;
    return database.prepare(sql).run().changes;
}
/**
 * Update a memory entry (content, summary, tags, importance).
 * Returns true if the update succeeded.
 */
export function updateMemory(repoPath, id, { content, summary, tags, importance, } = {}) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    const sets = [];
    const params = [];
    if (content !== undefined) {
        sets.push('content = ?');
        params.push(content);
    }
    if (summary !== undefined) {
        sets.push('summary = ?');
        params.push(summary);
    }
    if (tags !== undefined) {
        sets.push('tags = ?');
        params.push(tags.join(','));
    }
    if (importance !== undefined) {
        sets.push('importance = ?');
        params.push(importance);
    }
    if (sets.length === 0) {
        return false;
    }
    sets.push("updated_at = datetime('now')");
    params.push(id);
    return (database
        .prepare(`UPDATE ${tableName} SET ${sets.join(', ')} WHERE id = ?`)
        .run(...params).changes > 0);
}
/**
 * Compact conversation memories by merging older memories.
 * Returns { original, compacted, removed }.
 */
export function compactConversationMemories(repoPath, conversationId) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    const memories = database
        .prepare(`SELECT * FROM ${tableName} WHERE conversation_id = ? ORDER BY created_at ASC`)
        .all(conversationId);
    if (memories.length <= 5) {
        return { original: memories.length, compacted: memories.length, removed: 0 };
    }
    const groups = {};
    for (const m of memories) {
        const k = `${m.memory_type}:${m.agent_name}`;
        if (!groups[k]) {
            groups[k] = [];
        }
        groups[k].push(m);
    }
    let removed = 0;
    for (const group of Object.values(groups)) {
        if (group.length <= 2) {
            continue;
        }
        const latest = group[group.length - 1];
        const older = group.slice(0, -1);
        const mergedSummary = older
            .map((m) => m.summary || m.content.slice(0, 100))
            .join(' | ');
        for (const old of older) {
            database.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(old.id);
            try {
                const mapping = database
                    .prepare(`SELECT vec_rowid FROM ${tableName}_vec_map WHERE memory_id = ?`)
                    .get(old.id);
                if (mapping) {
                    database.prepare(`DELETE FROM ${tableName}_vec WHERE rowid = ?`).run(mapping.vec_rowid);
                    database.prepare(`DELETE FROM ${tableName}_vec_map WHERE memory_id = ?`).run(old.id);
                }
            }
            catch {
                /* no vec */
            }
            removed++;
        }
        database
            .prepare(`UPDATE ${tableName} SET summary = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(`[${removed} older] ${mergedSummary} | ${latest.summary || ''}`.slice(0, 2000), latest.id);
    }
    return { original: memories.length, compacted: memories.length - removed, removed };
}
// ============================================================
// UNIFIED KNOWLEDGE BASE
// ============================================================
/**
 * Save or update a knowledge entry (upsert by category + key).
 * Returns true if successful.
 */
export function saveKnowledge(repoPath, { category, key, title, content, metadata, tags, indexedBy, importance = 0.5, }) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    const knName = `${tableName}_knowledge`;
    database
        .prepare(`
    INSERT INTO ${knName} (category, key, title, content, metadata, tags, indexed_by, indexed_at, importance)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(category, key) DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      metadata = excluded.metadata,
      tags = excluded.tags,
      indexed_by = excluded.indexed_by,
      indexed_at = datetime('now'),
      importance = excluded.importance
  `)
        .run(category, key, title, content || null, metadata ? JSON.stringify(metadata) : null, tags ? tags.join(',') : null, indexedBy || null, importance);
    return true;
}
/**
 * Batch save knowledge entries in a single transaction.
 * Returns the count of entries saved.
 */
export function batchSaveKnowledge(repoPath, entries, indexedBy) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    const knName = `${tableName}_knowledge`;
    const stmt = database.prepare(`
    INSERT INTO ${knName} (category, key, title, content, metadata, tags, indexed_by, indexed_at, importance)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(category, key) DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      metadata = excluded.metadata,
      tags = excluded.tags,
      indexed_by = excluded.indexed_by,
      indexed_at = datetime('now'),
      importance = excluded.importance
  `);
    const transaction = database.transaction((items) => {
        for (const e of items) {
            stmt.run(e.category, e.key, e.title, e.content || null, e.metadata ? JSON.stringify(e.metadata) : null, e.tags ? e.tags.join(',') : null, indexedBy || null, e.importance || 0.5);
        }
    });
    transaction(entries);
    return entries.length;
}
/**
 * Search knowledge entries by text across key, title, content, and tags.
 * Bumps access_count for matched entries.
 */
export function searchKnowledge(repoPath, { query, category, limit = 30, } = {
    query: '',
}) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    const knName = `${tableName}_knowledge`;
    const ftsName = `${knName}_fts`;
    const safeQuery = sanitizeFts5Query(query);
    let sql = `SELECT k.* FROM ${knName} k JOIN ${ftsName} fts ON k.id = fts.rowid WHERE ${ftsName} MATCH ?`;
    const params = [safeQuery];
    if (category) {
        sql += ` AND k.category = ?`;
        params.push(category);
    }
    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);
    // Bump access count for matched entries
    database
        .prepare(`
    UPDATE ${knName} SET access_count = access_count + 1 WHERE id IN (
      SELECT k.id FROM ${knName} k JOIN ${ftsName} fts ON k.id = fts.rowid WHERE ${ftsName} MATCH ?
    )
  `)
        .run(safeQuery);
    const results = database.prepare(sql).all(...params);
    // Parse metadata
    for (const row of results) {
        if (row.metadata && typeof row.metadata === 'string') {
            try {
                row.metadata = JSON.parse(row.metadata);
            }
            catch {
                /* keep as string */
            }
        }
    }
    return results;
}
/**
 * Get a specific knowledge entry by category + key.
 * Bumps access_count.
 */
export function getKnowledge(repoPath, { category, key }) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    const knName = `${tableName}_knowledge`;
    database
        .prepare(`UPDATE ${knName} SET access_count = access_count + 1 WHERE category = ? AND key = ?`)
        .run(category, key);
    const row = database
        .prepare(`SELECT * FROM ${knName} WHERE category = ? AND key = ?`)
        .get(category, key);
    if (row && row.metadata && typeof row.metadata === 'string') {
        try {
            row.metadata = JSON.parse(row.metadata);
        }
        catch {
            /* keep as string */
        }
    }
    return row;
}
/**
 * List knowledge entries, optionally filtered by category.
 */
export function listKnowledge(repoPath, { category, limit = 200, offset = 0, } = {}) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    const knName = `${tableName}_knowledge`;
    let sql = `SELECT * FROM ${knName} WHERE 1=1`;
    const params = [];
    if (category) {
        sql += ` AND category = ?`;
        params.push(category);
    }
    sql += ` ORDER BY access_count DESC, indexed_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    const rows = database.prepare(sql).all(...params);
    for (const row of rows) {
        if (row.metadata && typeof row.metadata === 'string') {
            try {
                row.metadata = JSON.parse(row.metadata);
            }
            catch {
                /* keep */
            }
        }
    }
    return rows;
}
/**
 * Get knowledge statistics for a repository.
 */
export function getKnowledgeStats(repoPath) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    const knName = `${tableName}_knowledge`;
    const total = database
        .prepare(`SELECT COUNT(*) as count FROM ${knName}`)
        .get();
    const byCategory = database
        .prepare(`SELECT category, COUNT(*) as count FROM ${knName} GROUP BY category ORDER BY count DESC`)
        .all();
    const topAccessed = database
        .prepare(`SELECT category, key, title, access_count FROM ${knName} ORDER BY access_count DESC LIMIT 15`)
        .all();
    return {
        total: total.count,
        by_category: byCategory,
        top_accessed: topAccessed,
    };
}
/**
 * Find knowledge entries that are potentially stale (older than N days).
 */
export function getStaleKnowledge(repoPath, { olderThanDays = 7, category, limit = 100, } = {}) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    const knName = `${tableName}_knowledge`;
    let sql = `SELECT * FROM ${knName} WHERE indexed_at < datetime('now', '-${olderThanDays} days')`;
    const params = [];
    if (category) {
        sql += ` AND category = ?`;
        params.push(category);
    }
    sql += ` ORDER BY indexed_at ASC LIMIT ?`;
    params.push(limit);
    return database.prepare(sql).all(...params);
}
/**
 * Delete a knowledge entry by category + key.
 * Returns true if the deletion succeeded.
 */
export function deleteKnowledge(repoPath, { category, key }) {
    const database = getDb();
    const tableName = ensureRepoTable(repoPath);
    const knName = `${tableName}_knowledge`;
    return (database
        .prepare(`DELETE FROM ${knName} WHERE category = ? AND key = ?`)
        .run(category, key).changes > 0);
}
