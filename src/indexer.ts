#!/usr/bin/env node

import Database from "better-sqlite3";
import { createRequire } from "module";
import { join, dirname, extname, relative } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { readFileSync, statSync, existsSync } from "fs";
import chokidar from "chokidar";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  getDb,
  getFileIndexMeta,
  upsertFileIndexMeta,
  deleteFileChunks,
  insertFileChunk,
  countFileChunks,
  deleteAllFileChunks,
  deleteFileIndexMeta,
} from "./db.js";

const require = createRequire(import.meta.url);
const sqliteVec = require("sqlite-vec");

// ── Constants ──────────────────────────────────────────────────

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".svg",
  ".webp",
  ".tiff",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".flac",
  ".aac",
  ".avi",
  ".mov",
  ".mkv",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".dat",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".sqlite",
  ".db",
  ".sqlite3",
  ".pkl",
  ".pickle",
  ".npy",
  ".npz",
  ".pt",
  ".onnx",
  ".lock",
  ".cache",
]);

const DEFAULT_IGNORE_PATTERNS = [
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  "out/**",
  ".next/**",
  ".nuxt/**",
  "coverage/**",
  "__pycache__/**",
  ".DS_Store",
  "*.pyc",
  "*.pyo",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.wasm",
  "*.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Gemfile.lock",
  "Cargo.lock",
  "poetry.lock",
  "composer.lock",
  "vendor/**",
  ".venv/**",
  "venv/**",
  "target/**",
  ".gradle/**",
  ".idea/**",
  ".vscode/**",
];

// ── Ignore function for chokidar v4 (no glob support) ─────────

/**
 * chokidar v4 removed glob support. The `ignored` option only accepts
 * a function, regex, or plain path string - NOT glob patterns.
 * This converts our glob-style patterns into a function that tests paths.
 */
function createChokidarIgnoreFunction(
  patterns: string[],
): (path: string, stats?: { isFile(): boolean; isDirectory(): boolean }) => boolean {
  const ignoreDirNames = new Set<string>();
  const ignoreExtensions = new Set<string>();
  const ignoreFileNames = new Set<string>();
  const ignoreExact: string[] = [];

  for (let rawPattern of patterns) {
    // Strip leading "**/" prefix that parseGitignore adds — classify the inner pattern
    let pattern = rawPattern;
    if (pattern.startsWith("**/")) {
      pattern = pattern.slice(3);
    }

    // After stripping, re-classify:
    // "dirname/**" → directory name
    const dirMatch = pattern.match(/^(.+?)\/\*{1,2}$/);
    if (dirMatch && !dirMatch[1].includes("*")) {
      ignoreDirNames.add(dirMatch[1]);
      continue;
    }
    // "*.ext" → file extension
    const extMatch = pattern.match(/^\*(\.\S+)$/);
    if (extMatch) {
      ignoreExtensions.add(extMatch[1]);
      continue;
    }
    // "dirname/" → directory
    if (pattern.endsWith("/") && !pattern.includes("*")) {
      ignoreDirNames.add(pattern.slice(0, -1));
      continue;
    }
    // ".name" (hidden files/dirs like .git, .DS_Store, .env)
    if (pattern.startsWith(".") && !pattern.includes("/") && !pattern.includes("*")) {
      // Could be a file (.env) or a dir (.git) — check against both name and dir
      ignoreFileNames.add(pattern);
      ignoreDirNames.add(pattern);
      continue;
    }
    // "dirname" (bare name, no wildcards) → directory match
    if (!pattern.includes("*") && !pattern.includes("/")) {
      ignoreDirNames.add(pattern);
      continue;
    }
    // Fallback: exact substring match
    ignoreExact.push(pattern);
  }

  return (filePath: string) => {
    const normalized = filePath.replace(/\\/g, "/");
    const parts = normalized.split("/");
    const fileName = parts[parts.length - 1] || "";

    // Check directory names in path components
    for (const part of parts) {
      if (ignoreDirNames.has(part)) return true;
    }

    // Check exact file names (e.g. .env, .DS_Store)
    if (ignoreFileNames.has(fileName)) return true;

    // Check file extensions
    for (const ext of ignoreExtensions) {
      if (fileName.endsWith(ext)) return true;
    }

    // Check exact patterns
    for (const exact of ignoreExact) {
      if (normalized.includes(exact)) return true;
    }

    return false;
  };
}

// ── Vector DB (separate from main DB) ──────────────────────────

const OPENCODE_DB_PATH =
  process.env.OPENCODE_DB_PATH ||
  join(homedir(), ".local", "share", "opencode", "opencode.db");

const FILE_INDEX_DB_DIR = dirname(OPENCODE_DB_PATH);

let vecDb: Database.Database | null = null;

function getVecDb(): Database.Database {
  if (!vecDb) {
    const dbPath = join(FILE_INDEX_DB_DIR, "kanban-file-index.db");
    vecDb = new Database(dbPath);
    vecDb.pragma("journal_mode = WAL");
    vecDb.loadExtension(sqliteVec.getLoadablePath());
    vecDb.exec(`
      CREATE TABLE IF NOT EXISTS chunk_vec_map (
        chunk_id INTEGER PRIMARY KEY,
        vec_rowid INTEGER NOT NULL,
        board_id INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chunk_vec_map_board ON chunk_vec_map(board_id);
    `);
  }
  return vecDb;
}

function ensureBoardVecTable(boardId: number, dimensions: number = 1024): string {
  const vdb = getVecDb();
  const tableName = `board_${boardId}_vec`;
  vdb.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(embedding float[${dimensions}])`,
  );
  return tableName;
}

// ── Settings helpers ────────────────────────────────────────────

function getIndexSetting(key: string, defaultVal: string): string {
  const row = getDb()
    .prepare("SELECT value FROM kanban_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? defaultVal;
}

// ── AWS Bedrock embedding client ────────────────────────────────

let bedrockClient: BedrockRuntimeClient | null = null;

function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    const profile = getIndexSetting("file_indexing_aws_profile", "default");
    const region = getIndexSetting("file_indexing_aws_region", "us-east-1");
    // Set AWS_PROFILE BEFORE constructing the client — SDK reads it at credential provider init
    process.env.AWS_PROFILE = profile || "default";
    bedrockClient = new BedrockRuntimeClient({
      region,
      requestHandler: {
        requestTimeout: 30_000, // 30s timeout per embedding call
      },
    });
  }
  return bedrockClient;
}

const MAX_EMBEDDING_RETRIES = 3;

async function getEmbeddings(
  texts: string[],
): Promise<number[][]> {
  const client = getBedrockClient();
  const modelId = getIndexSetting("file_indexing_embedding_model", "amazon.titan-embed-text-v2:0");

  const results: number[][] = [];

  for (const text of texts) {
    const body = JSON.stringify({ inputText: text });

    const command = new InvokeModelCommand({
      modelId,
      body,
      contentType: "application/json",
      accept: "application/json",
    });

    // Retry with exponential backoff for throttling
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_EMBEDDING_RETRIES; attempt++) {
      try {
        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        if (!responseBody.embedding) {
          throw new Error(`No embedding returned from Bedrock model ${modelId}`);
        }

        results.push(responseBody.embedding);
        lastError = null;
        break;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isThrottle = lastError.name === "ThrottlingException"
          || lastError.name === "ServiceUnavailableException"
          || lastError.name === "TooManyRequestsException"
          || lastError.message.includes("throttl")
          || lastError.message.includes("rate")
          || lastError.message.includes("429");

        if (isThrottle && attempt < MAX_EMBEDDING_RETRIES - 1) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 10_000);
          console.error(`[indexer] Bedrock throttled, retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_EMBEDDING_RETRIES})`);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw lastError;
      }
    }
    if (lastError) throw lastError;
  }

  return results;
}

// ── AWS profile helpers ────────────────────────────────────────

function listAwsProfiles(): string[] {
  const profiles: string[] = [];
  const credPath = join(homedir(), ".aws", "credentials");
  const configPath = join(homedir(), ".aws", "config");

  for (const filePath of [credPath, configPath]) {
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      // Match [profile name] or [name] (credentials uses [name], config uses [profile name])
      const match = trimmed.match(/^\[(?:profile\s+)?([^\]]+)\]/);
      if (match) {
        const name = match[1].trim();
        if (!profiles.includes(name)) {
          profiles.push(name);
        }
      }
    }
  }

  return profiles.sort();
}

async function testAwsConnection(
  profile?: string,
  region?: string,
  modelId?: string,
): Promise<{ ok: boolean; error?: string; model?: string; dimensions?: number }> {
  const prof = profile || getIndexSetting("file_indexing_aws_profile", "default");
  const reg = region || getIndexSetting("file_indexing_aws_region", "us-east-1");
  const model = modelId || getIndexSetting("file_indexing_embedding_model", "amazon.titan-embed-text-v2:0");

  try {
    // Create a temporary client for testing
    const testClient = new BedrockRuntimeClient({
      region: reg,
    });

    // Set profile via env var
    const origProfile = process.env.AWS_PROFILE;
    process.env.AWS_PROFILE = prof;

    try {
      const command = new InvokeModelCommand({
        modelId: model,
        body: JSON.stringify({ inputText: "test" }),
        contentType: "application/json",
        accept: "application/json",
      });

      const response = await testClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      const dims = responseBody.embedding?.length || 0;
      return { ok: true, model, dimensions: dims };
    } finally {
      // Restore original profile
      if (origProfile !== undefined) {
        process.env.AWS_PROFILE = origProfile;
      } else {
        delete process.env.AWS_PROFILE;
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/** Reset the cached Bedrock client (call when settings change) */
function resetBedrockClient(): void {
  bedrockClient = null;
}

// ── Gitignore parser ───────────────────────────────────────────

function parseGitignore(repoPath: string): string[] {
  const gitignorePath = join(repoPath, ".gitignore");
  if (!existsSync(gitignorePath)) return [];
  const content = readFileSync(gitignorePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((pattern) => {
      if (!pattern.startsWith("/") && !pattern.includes("**")) {
        return `**/${pattern}`;
      }
      return pattern;
    });
}

// ── Chunking ───────────────────────────────────────────────────

interface Chunk {
  content: string;
  lineStart: number;
  lineEnd: number;
}

function chunkContent(
  content: string,
  chunkSize: number,
  overlap: number,
): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  let currentLine = 0;

  // Estimate average line length to convert char overlap to line overlap
  const totalChars = lines.reduce((sum, l) => sum + l.length + 1, 0);
  const avgLineLen = lines.length > 0 ? totalChars / lines.length : 50;
  const overlapLines = Math.max(1, Math.round(overlap / avgLineLen));

  while (currentLine < lines.length) {
    let charCount = 0;
    let endLine = currentLine;

    // Accumulate lines until we hit the target chunk size
    while (endLine < lines.length && charCount < chunkSize) {
      charCount += lines[endLine].length + 1; // +1 for newline
      endLine++;
    }

    // Skip empty chunks
    if (endLine === currentLine) {
      currentLine++;
      continue;
    }

    const chunkText = lines.slice(currentLine, endLine).join("\n");
    if (chunkText.trim().length > 0) {
      chunks.push({
        content: chunkText,
        lineStart: currentLine + 1, // 1-indexed
        lineEnd: endLine,
      });
    }

    // Advance by (chunk lines - overlap lines) to create overlap
    const chunkLines = endLine - currentLine;
    currentLine = currentLine + chunkLines - overlapLines;

    // Safety: ensure we always make forward progress
    if (currentLine <= chunks[chunks.length - 1].lineStart - 1) {
      currentLine = endLine;
    }
  }

  return chunks;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function isBinaryFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;

  // Check for null bytes in first 8KB
  try {
    const fd = readFileSync(filePath);
    const checkBytes = Math.min(fd.length, 8192);
    for (let i = 0; i < checkBytes; i++) {
      if (fd[i] === 0) return true;
    }
  } catch {
    return true;
  }
  return false;
}

// ── Vector cleanup helpers ─────────────────────────────────────

function deleteFileVectors(boardId: number, filePath: string): void {
  const mainDb = getDb();
  const vdb = getVecDb();

  // Get chunk IDs for this file
  const chunkRows = mainDb
    .prepare(
      "SELECT id FROM kanban_file_index WHERE board_id = ? AND file_path = ?",
    )
    .all(boardId, filePath) as Array<{ id: number }>;

  if (chunkRows.length === 0) return;

  const chunkIds = chunkRows.map((r) => r.id);

  // Get vec_rowids for these chunks
  const vecRows = vdb
    .prepare(
      "SELECT vec_rowid FROM chunk_vec_map WHERE chunk_id IN (SELECT value FROM json_each(?)) AND board_id = ?",
    )
    .all(JSON.stringify(chunkIds), boardId) as Array<{ vec_rowid: number }>;

  // Delete from the vec virtual table by rowid
  const vecTable = `board_${boardId}_vec`;
  const deleteStmt = vdb.prepare(`DELETE FROM ${vecTable} WHERE rowid = ?`);
  for (const row of vecRows) {
    deleteStmt.run(row.vec_rowid);
  }

  // Delete from the mapping table
  vdb
    .prepare(
      "DELETE FROM chunk_vec_map WHERE chunk_id IN (SELECT value FROM json_each(?)) AND board_id = ?",
    )
    .run(JSON.stringify(chunkIds), boardId);
}

// ── File indexing ──────────────────────────────────────────────

async function indexSingleFile(
  boardId: number,
  repoPath: string,
  relativePath: string,
  chunkSize: number,
  chunkOverlap: number,
  maxFileSize: number,
): Promise<{ chunks: number; skipped: boolean }> {
  const fullPath = join(repoPath, relativePath);

  // Check file size
  const stat = statSync(fullPath);
  if (stat.size > maxFileSize) return { chunks: 0, skipped: true };

  // Check binary
  if (isBinaryFile(fullPath)) return { chunks: 0, skipped: true };

  // Read content
  let content: string;
  try {
    content = readFileSync(fullPath, "utf-8");
  } catch {
    return { chunks: 0, skipped: true };
  }

  if (content.trim().length === 0) return { chunks: 0, skipped: true };

  // Chunk
  const chunks = chunkContent(content, chunkSize, chunkOverlap);
  if (chunks.length === 0) return { chunks: 0, skipped: true };

  // Clean up existing vectors for this file
  deleteFileVectors(boardId, relativePath);

  // Delete existing chunks for this file from main DB
  deleteFileChunks(boardId, relativePath);

  // Batch embed (10 chunks per request max)
  const BATCH_SIZE = 10;
  const dimensions = parseInt(
    getIndexSetting("file_indexing_embedding_dimensions", "1024"),
    10,
  );
  const vecTableName = ensureBoardVecTable(boardId, dimensions);
  const vdb = getVecDb();

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.content);

    let embeddings: number[][];
    try {
      embeddings = await getEmbeddings(texts);
    } catch (err) {
      console.error(`[indexer] Embedding failed for ${relativePath}:`, err);
      throw err;
    }

    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];
      const embedding = embeddings[j];
      const contentHash = hashContent(chunk.content);

      // Insert chunk into main DB
      const chunkId = insertFileChunk(
        boardId,
        relativePath,
        contentHash,
        chunk.lineStart,
        chunk.lineEnd,
        chunk.content,
      );

      // Insert vector into vec DB
      const float32 = new Float32Array(embedding);
      const buf = Buffer.from(float32.buffer);
      const vecResult = vdb
        .prepare(`INSERT INTO ${vecTableName}(embedding) VALUES (?)`)
        .run(buf);

      // Map chunk_id to vec_rowid
      vdb
        .prepare(
          "INSERT INTO chunk_vec_map (chunk_id, vec_rowid, board_id) VALUES (?, ?, ?)",
        )
        .run(chunkId, Number(vecResult.lastInsertRowid), boardId);
    }
  }

  return { chunks: chunks.length, skipped: false };
}

// ── Full index ─────────────────────────────────────────────────

async function indexAllFiles(
  boardId: number,
  repoPath: string,
  onProgress?: (indexed: number, total: number, currentFile: string) => void,
): Promise<{ totalFiles: number; totalChunks: number; errors: string[] }> {
  const chunkSize = parseInt(
    getIndexSetting("file_indexing_chunk_size", "2000"),
    10,
  );
  const chunkOverlap = parseInt(
    getIndexSetting("file_indexing_chunk_overlap", "200"),
    10,
  );
  const maxFileSize = parseInt(
    getIndexSetting("file_indexing_max_file_size", "1048576"),
    10,
  );

  // Set status to indexing
  upsertFileIndexMeta(boardId, {
    status: "indexing",
    status_message: "Starting full index...",
  });

  // Walk directory
  const gitignorePatterns = parseGitignore(repoPath);
  const allIgnorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...gitignorePatterns];

  // Use chokidar to collect files (it handles gitignore-like patterns)
  const files: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const watcher = chokidar.watch(repoPath, {
      ignored: createChokidarIgnoreFunction(allIgnorePatterns),
      persistent: false,
      ignoreInitial: false,
    });

    watcher.on("add", (filePath) => {
      files.push(relative(repoPath, filePath));
    });

    watcher.on("ready", () => {
      watcher.close();
      resolve();
    });

    watcher.on("error", (err) => {
      watcher.close();
      reject(err);
    });
  });

  const errors: string[] = [];
  let totalChunks = 0;
  let indexed = 0;

  // Process files concurrently in small batches to avoid Bedrock throttling
  const CONCURRENCY = 5;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (file) => {
        try {
          const result = await indexSingleFile(
            boardId,
            repoPath,
            file,
            chunkSize,
            chunkOverlap,
            maxFileSize,
          );
          return { file, chunks: result.chunks, skipped: result.skipped };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return { file, error: message };
        }
      }),
    );

    for (const settled of results) {
      indexed++;
      if (settled.status === "fulfilled") {
        const val = settled.value;
        if ("error" in val) {
          errors.push(`${val.file}: ${val.error}`);
          console.error(`[indexer] Error indexing ${val.file}: ${val.error}`);
        } else {
          totalChunks += val.chunks;
        }
      }
    }

    // Update progress with last file in batch
    const lastFile = batch[batch.length - 1];
    upsertFileIndexMeta(boardId, {
      status: "indexing",
      status_message: `Indexing ${lastFile} (${indexed}/${files.length})...`,
    });
    onProgress?.(indexed, files.length, lastFile);

    // Small delay between batches to avoid Bedrock rate limiting
    if (i + CONCURRENCY < files.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  const counts = countFileChunks(boardId);
  upsertFileIndexMeta(boardId, {
    status: "idle",
    status_message:
      errors.length > 0 ? `${errors.length} errors` : "Indexing complete",
    total_files: counts.files,
    total_chunks: counts.chunks,
    last_full_index: new Date().toISOString(),
  });

  return { totalFiles: files.length, totalChunks, errors };
}

// ── Vector search ──────────────────────────────────────────────

export interface FileSearchResult {
  file_path: string;
  line_start: number;
  line_end: number;
  content: string;
  score: number;
}

async function searchFiles(
  boardId: number,
  query: string,
  topK: number = 5,
): Promise<FileSearchResult[]> {
  const dimensions = parseInt(
    getIndexSetting("file_indexing_embedding_dimensions", "1024"),
    10,
  );

  // Get query embedding
  const embeddings = await getEmbeddings([query]);
  const queryVec = embeddings[0];
  if (!queryVec || queryVec.length !== dimensions) return [];

  const float32 = new Float32Array(queryVec);
  const buf = Buffer.from(float32.buffer);

  const vecTableName = `board_${boardId}_vec`;
  const vdb = getVecDb();

  // Check if vec table exists
  const tableExists = vdb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(vecTableName);
  if (!tableExists) return [];

  const vecRows = vdb
    .prepare(
      `SELECT rowid, distance FROM ${vecTableName} WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
    )
    .all(buf, topK) as Array<{ rowid: number; distance: number }>;

  const results: FileSearchResult[] = [];
  const mainDb = getDb();

  for (const vecRow of vecRows) {
    const mapping = vdb
      .prepare(
        "SELECT chunk_id FROM chunk_vec_map WHERE vec_rowid = ? AND board_id = ?",
      )
      .get(vecRow.rowid, boardId) as { chunk_id: number } | undefined;

    if (mapping) {
      const chunk = mainDb
        .prepare(
          "SELECT file_path, line_start, line_end, content FROM kanban_file_index WHERE id = ?",
        )
        .get(mapping.chunk_id) as
        | {
            file_path: string;
            line_start: number;
            line_end: number;
            content: string;
          }
        | undefined;

      if (chunk) {
        results.push({ ...chunk, score: vecRow.distance });
      }
    }
  }

  return results;
}

// ── Context injection helper ───────────────────────────────────

export async function getFileContext(
  boardId: number,
  query: string,
  maxChars: number = 4000,
): Promise<string> {
  const enabled = getIndexSetting("file_indexing_enabled", "true");
  if (enabled !== "true") return "";

  const meta = getFileIndexMeta(boardId);
  if (!meta || meta.total_chunks === 0) return "";

  const topK = parseInt(getIndexSetting("file_indexing_top_k", "5"), 10);

  try {
    const results = await searchFiles(boardId, query, topK);
    if (results.length === 0) return "";

    let totalChars = 0;
    const parts: string[] = [];

    for (const r of results) {
      const snippet = `### ${r.file_path} (L${r.line_start}-${r.line_end})\n\`\`\`\n${r.content}\n\`\`\``;
      if (totalChars + snippet.length > maxChars) break;
      parts.push(snippet);
      totalChars += snippet.length;
    }

    if (parts.length === 0) return "";
    return `## Relevant File Context\n${parts.join("\n\n")}`;
  } catch {
    return "";
  }
}

// ── File watcher ───────────────────────────────────────────────

const activeWatchers = new Map<number, ReturnType<typeof chokidar.watch>>();

function startWatching(boardId: number, repoPath: string): void {
  if (activeWatchers.has(boardId)) return;

  const chunkSize = parseInt(
    getIndexSetting("file_indexing_chunk_size", "2000"),
    10,
  );
  const chunkOverlap = parseInt(
    getIndexSetting("file_indexing_chunk_overlap", "200"),
    10,
  );
  const maxFileSize = parseInt(
    getIndexSetting("file_indexing_max_file_size", "1048576"),
    10,
  );

  const gitignorePatterns = parseGitignore(repoPath);
  const allIgnorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...gitignorePatterns];

  const watcher = chokidar.watch(repoPath, {
    ignored: createChokidarIgnoreFunction(allIgnorePatterns),
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 500,
    },
  });

  const handleIndex = async (
    filePath: string,
    action: string,
  ): Promise<void> => {
    const relPath = relative(repoPath, filePath);
    console.error(`[indexer] File ${action}: ${relPath}`);
    try {
      await indexSingleFile(
        boardId,
        repoPath,
        relPath,
        chunkSize,
        chunkOverlap,
        maxFileSize,
      );
      const counts = countFileChunks(boardId);
      upsertFileIndexMeta(boardId, {
        total_files: counts.files,
        total_chunks: counts.chunks,
      });
    } catch (err) {
      console.error(`[indexer] Error ${action} ${relPath}:`, err);
    }
  };

  watcher.on("change", (filePath) => handleIndex(filePath, "changed"));

  watcher.on("add", (filePath) => handleIndex(filePath, "added"));

  watcher.on("unlink", (filePath) => {
    const relPath = relative(repoPath, filePath);
    console.error(`[indexer] File removed: ${relPath}`);
    deleteFileVectors(boardId, relPath);
    deleteFileChunks(boardId, relPath);
    const counts = countFileChunks(boardId);
    upsertFileIndexMeta(boardId, {
      total_files: counts.files,
      total_chunks: counts.chunks,
    });
  });

  activeWatchers.set(boardId, watcher);
  upsertFileIndexMeta(boardId, {
    status: "watching",
    status_message: "Watching for file changes",
  });
  console.error(`[indexer] Started watching board ${boardId}: ${repoPath}`);
}

function stopWatching(boardId: number): void {
  const watcher = activeWatchers.get(boardId);
  if (watcher) {
    watcher.close();
    activeWatchers.delete(boardId);
    const meta = getFileIndexMeta(boardId);
    if (meta && meta.status === "watching") {
      upsertFileIndexMeta(boardId, {
        status: "idle",
        status_message: "Stopped watching",
      });
    }
    console.error(`[indexer] Stopped watching board ${boardId}`);
  }
}

function isWatching(boardId: number): boolean {
  return activeWatchers.has(boardId);
}

// ── Public API ─────────────────────────────────────────────────

export const fileIndexer = {
  indexAllFiles,
  indexSingleFile,
  searchFiles,
  getFileContext,
  startWatching,
  stopWatching,
  isWatching,
  listAwsProfiles,
  testAwsConnection,
  resetBedrockClient,
  getFileIndexMeta,
  countFileChunks,
  deleteAllFileChunks,
};
