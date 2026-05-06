# Swarm Mode with Epics & Task Keys — Implementation Plan

> **Status:** Planning
> **Date:** 2026-05-04
> **Author:** AI Architect
> **Affects:** Backend (Express/MCP), Frontend (React), Database (SQLite)

---

## Table of Contents

1. [Project Context](#project-context)
2. [Overview](#overview)
3. [Architecture](#architecture)
4. [Data Model](#data-model)
5. [Task Key System](#task-key-system)
6. [Flow](#flow)
7. [Tasks](#tasks)
8. [Post-Plan Checklist](#post-plan-checklist)
9. [Risk Flags](#risk-flags)
10. [Decision Log](#decision-log)

---

## Project Context

| Field | Value |
|-------|-------|
| **Type** | Full-stack: MCP server + Express backend + React SPA |
| **Language** | TypeScript (Node.js + React 19) |
| **Framework** | Express + Vite + TanStack Virtual |
| **UI Library** | shadcn/ui (radix-ui) + Tailwind CSS 4 |
| **Build** | `tsc` (backend), `vite build` (frontend) |
| **Database** | SQLite (better-sqlite3) shared with opencode |
| **Package Manager** | npm (monorepo: root + web/) |

### Key Files

| File | Purpose |
|------|---------|
| `src/schema.sql` | Database schema |
| `src/db.ts` | Database functions |
| `src/types.ts` | Backend TypeScript types |
| `src/web.ts` | Express web server + REST API |
| `src/event-bus.ts` | SSE event bus |
| `web/src/types.ts` | Frontend TypeScript types |
| `web/src/main.tsx` | App root, state management |
| `web/src/components/session-detail.tsx` | Session detail panel (chat + input) |
| `web/src/components/kanban-board.tsx` | Board layout |
| `web/src/components/kanban-column.tsx` | Column with cards |
| `web/src/components/kanban-card.tsx` | Regular session card |
| `web/src/hooks/use-kanban.ts` | Board data fetching + SSE |

---

## Overview

Swarm Mode is a toggle in the new-session panel. When enabled, the user's task is sent to an **AI Planner agent** that decomposes it into independent subtasks. Each subtask becomes its own opencode session, tracked under an **Epic** entity with a unique **task key** (e.g., `OK-1`).

The Epic card appears on the kanban board with a live progress bar. Clicking it opens a **Swarm Status Panel** showing the full AI plan and all child session statuses. Children are accessible only through the Epic (not as separate board cards).

---

## Architecture

```
 ┌──────────────────────────────────────────────────────────────────┐
 │                      KANBAN BOARD                                │
 │                                                                  │
 │  Backlog              In Progress           Done                 │
 │  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     │
 │  │  Regular Card │     │              │     │              │     │
 │  │  "Fix login"  │     │              │     │              │     │
 │  └──────────────┘     │              │     │              │     │
 │  ┌──────────────────────────────────────────────────────┐ │     │
 │  │  EPIC  OK-1  "Build a blog system"                   │ │     │
 │  │  ████████░░░░ 3/5  OK-1.1 done  OK-1.2 done          │ │     │
 │  │                    OK-1.3 busy  OK-1.4 pending         │ │     │
 │  └──────────────────────────────────────────────────────┘ │     │
 │  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     │
 │  │  Regular Card │     │              │     │              │     │
 │  └──────────────┘     └──────────────┘     └──────────────┘     │
 └──────────────────────────────────────────────────────────────────┘
                              │ Click epic
                              v
 ┌──────────────────────────────────────────────────────────────────┐
 │  SWARM STATUS PANEL (replaces session detail panel)             │
 │                                                                  │
 │  OK-1: Build a blog system                              x Close │
 │  "Create a full blog with user auth, posts API, frontend..."    │
 │                                                                  │
 │  Progress: ████████░░░░ 3/5 completed                            │
 │                                                                  │
 │  OK-1.1  done  Create user model                    [view]       │
 │  OK-1.2  done  Build posts API                      [view]       │
 │  OK-1.3  busy  Add authentication                   [view]       │
 │  OK-1.4  idle  Write tests                          [view]       │
 │  OK-1.5  idle  Add documentation                    [view]       │
 │                                                                  │
 │  Plan Details (collapsible):                                     │
 │  The planner analyzed the task and decided...                    │
 └──────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### New Tables

```sql
-- Epics: swarm/epic tracking with task keys
CREATE TABLE IF NOT EXISTS kanban_epics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  task_key TEXT NOT NULL,              -- e.g., "OK-1"
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  plan_text TEXT DEFAULT '',           -- Planner's full analysis
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK(status IN ('planning', 'spawning', 'running', 'completed', 'failed')),
  planner_session_id TEXT,             -- The session that did the planning
  column_name TEXT NOT NULL DEFAULT 'Backlog',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(board_id, task_key)
);

-- Epic sessions: spawned sessions linked to an epic
CREATE TABLE IF NOT EXISTS kanban_epic_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  epic_id INTEGER NOT NULL REFERENCES kanban_epics(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  task_key TEXT NOT NULL,               -- e.g., "OK-1.1"
  subtask_index INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  UNIQUE(epic_id, session_id),
  UNIQUE(epic_id, task_key)
);

-- Task key counter per board
CREATE TABLE IF NOT EXISTS kanban_task_key_counters (
  board_id INTEGER NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  next_number INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (board_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_epics_board ON kanban_epics(board_id);
CREATE INDEX IF NOT EXISTS idx_epics_status ON kanban_epics(status);
CREATE INDEX IF NOT EXISTS idx_epics_planner ON kanban_epics(planner_session_id);
CREATE INDEX IF NOT EXISTS idx_epic_sessions_epic ON kanban_epic_sessions(epic_id);
CREATE INDEX IF NOT EXISTS idx_epic_sessions_session ON kanban_epic_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_task_key_counters_board ON kanban_task_key_counters(board_id);
```

### New Types

```typescript
// --- Backend (src/types.ts) ---

export interface Epic {
  id: number;
  board_id: number;
  task_key: string;
  title: string;
  description: string;
  plan_text: string;
  status: 'planning' | 'spawning' | 'running' | 'completed' | 'failed';
  planner_session_id: string | null;
  column_name: string;
  created_at: string;
  updated_at: string;
  sessions?: EpicSession[];
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

// BoardFull update:
export interface BoardFull {
  board: Board;
  columns: Column[];
  cards: Card[];
  epics: Epic[];    // NEW
}
```

```typescript
// --- Frontend (web/src/types.ts) ---

export interface Epic {
  id: number;
  board_id: number;
  task_key: string;
  title: string;
  description: string;
  plan_text: string;
  status: 'planning' | 'spawning' | 'running' | 'completed' | 'failed';
  planner_session_id: string | null;
  column_name: string;
  created_at: string;
  updated_at: string;
  sessions?: EpicSession[];
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

// BoardFull update:
export interface BoardFull {
  board: Board;
  columns: Column[];
  cards: Card[];
  epics: Epic[];    // NEW
}
```

---

## Task Key System

### Prefix Derivation

The task key prefix is auto-derived from the board name:

```typescript
function deriveTaskKeyPrefix(boardName: string): string {
  // Split by hyphens, underscores, spaces
  const parts = boardName
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .filter(Boolean);

  if (parts.length === 1) {
    // Single word: take first 2 chars
    return parts[0].substring(0, 2).toUpperCase();
  }
  // Multiple words: take first letter of each, max 3
  return parts.map(p => p[0]).join('').toUpperCase().substring(0, 3);
}
```

### Examples

| Board Name | Prefix | Epic Key | Child Keys |
|-----------|--------|----------|------------|
| `opencode-kanban` | `OK` | `OK-1` | `OK-1.1`, `OK-1.2` |
| `my-project` | `MP` | `MP-1` | `MP-1.1` |
| `frontend` | `FR` | `FR-1` | `FR-1.1` |
| `shop-backend-api` | `SBA` | `SBA-1` | `SBA-1.1` |
| `api` | `AP` | `AP-1` | `AP-1.1` |

### Auto-Increment

- `kanban_task_key_counters` stores `next_number` per board
- `getNextTaskKey(boardId)` atomically increments and returns `"OK-1"`, `"OK-2"`, etc.
- Child keys are computed: `epic.task_key + "." + (index + 1)` → `"OK-1.3"`

---

## Flow

### Phase 1: Planning

```
User types task + Swarm ON -> Send
        |
        v
  POST /api/sessions/swarm
  { directory, board_id, task, agent? }
        |
        v
  1. getNextTaskKey(board_id) -> "OK-1"
  2. createEpic(board_id, task, task, null) with status='planning'
  3. Create opencode planner session
  4. Send decomposition prompt to planner
  5. Return { planner_session_id, epic_id }
        |
        v
  Panel shows planner session in real-time
  (existing polling mechanism)
```

**Decomposition Prompt:**

```
You are a task decomposition specialist. Break down the following task into
independent subtasks that can be executed in parallel by separate AI agents.

Rules:
- Each subtask must be self-contained with all necessary context
- Clear scope and deliverable for each
- Between 2 and 8 subtasks
- Specific enough for an AI agent to execute independently

After your analysis, output a JSON array inside <swarm-plan> tags:
<swarm-plan>
[{"title": "Short title", "description": "Detailed description with all context needed..."}]
</swarm-plan>
```

### Phase 2: Reviewing

```
  Planner responds with <swarm-plan>[...]</swarm-plan>
        |
        v
  Frontend detects marker in last assistant message
  Parse JSON array -> validate
        |
        v
  Show breakdown panel:
  +------------------------------------------+
  | Swarm Plan: OK-1 - 5 subtasks            |
  |                                          |
  | 1. Create user model                     |
  |    Set up User with name, email...       |
  | 2. Build REST API                        |
  |    Create endpoints for CRUD...          |
  | ...                                      |
  |                                          |
  | [Spawn 5 Sessions]    [Cancel]           |
  +------------------------------------------+
```

### Phase 3: Spawning

```
  User clicks "Spawn N Sessions"
        |
        v
  POST /api/sessions/swarm/spawn
  { directory, board_id, epic_id, subtasks, original_task, agent? }
        |
        v
  For each subtask (i = 0..N):
    1. Create opencode session
    2. Child task key: "OK-1." + (i+1) -> "OK-1.3"
    3. Send subtask prompt:
       "You are part of a swarm working on: {original_task}
        Your specific assignment: {subtask.description}
        Focus ONLY on your assigned subtask."
    4. addEpicSession(epic_id, sessionId, childTaskKey, i, title, desc)
    5. Emit SSE epic_updated
        |
        v
  Update epic: status='running', column_name='In Progress'
  Auto-complete planner session
  Emit SSE epic_updated
        |
        v
  Close session detail panel
  Open SwarmStatusPanel for the epic
```

### Phase 4: Running

```
  Epic card on board shows progress bar
  SwarmStatusPanel shows all children with statuses
  SSE events update statuses in real-time
        |
        v
  When all children complete:
  Auto-update epic: status='completed', column_name='Done'
```

---

## Tasks

### TASK 1: Create shadcn Switch component

- **Agent:** @builder
- **Files:**
  - `web/src/components/ui/switch.tsx` (NEW)
- **Brief:** Standard shadcn/ui Switch component. Project has `radix-ui@1.4.3` (re-exports `@radix-ui/react-switch`). Follow existing pattern from `button.tsx` / `tabs.tsx` — use `class-variance-authority` for variants, `cn()` from `@/lib/utils`.
- **Depends on:** None
- **Conflicts:** None

---

### TASK 2: Database - Epic schema + task keys + DB functions

- **Agent:** @builder
- **Files:**
  - `src/schema.sql` (MODIFY - add 3 tables + indexes)
  - `src/db.ts` (MODIFY - add epic DB functions)
  - `src/types.ts` (MODIFY - add Epic, EpicSession types; update BoardFull)
- **Brief:**

  **Schema additions** (`schema.sql`):
  - `kanban_epics` table (see Data Model section)
  - `kanban_epic_sessions` table (see Data Model section)
  - `kanban_task_key_counters` table (see Data Model section)
  - All indexes

  **Types** (`src/types.ts`):
  - Add `Epic` interface (see Data Model section)
  - Add `EpicSession` interface (see Data Model section)
  - Update `BoardFull` to include `epics: Epic[]`

  **DB functions** (`db.ts`):

  Task key functions:
  - `deriveTaskKeyPrefix(boardName: string): string` - prefix derivation logic
  - `getNextTaskKey(boardId: number): string` - atomic auto-increment, returns e.g. `"OK-1"`

  Epic CRUD:
  - `createEpic(boardId: number, title: string, description: string, plannerSessionId: string | null): Epic`
  - `updateEpic(epicId: number, data: { status?, plan_text?, column_name?, title?, description? }): Epic | null`
  - `getEpic(epicId: number): Epic | null`
  - `getEpicsByBoard(boardId: number): Epic[]`
  - `deleteEpic(epicId: number): void`

  Epic session functions:
  - `addEpicSession(epicId: number, sessionId: string, taskKey: string, subtaskIndex: number, title: string, description: string): EpicSession`
  - `getEpicSessions(epicId: number): EpicSession[]`
  - `getEpicForSession(sessionId: string): Epic | null`

  Board query update:
  - Update `getBoardFull()` to include `epics` in the result:
    - Fetch all epics for the board
    - For each epic, populate `sessions` with `getEpicSessions()`
    - Return `{ board, columns, cards, epics }`

  Epic status auto-update:
  - `updateEpicStatus(epicId: number): void` - checks all children, updates epic status:
    - All children done -> `status='completed'`, `column_name='Done'`
    - Any child failed -> `status='failed'`
    - Otherwise -> `status='running'`

- **Depends on:** None
- **Conflicts:** None

---

### TASK 3: Backend - Swarm + Epic API endpoints

- **Agent:** @builder
- **Files:**
  - `src/web.ts` (MODIFY - add 4 endpoints)
  - `src/event-bus.ts` (MODIFY - add epic event types)
- **Brief:**

  **Event bus** (`src/event-bus.ts`):
  - Add `'epic_updated'` to event types
  - Payload: `{ epic_id: number, board_id: number, status: string }`

  **Endpoints** (`src/web.ts`):

  `POST /api/sessions/swarm` - Start planning:
  ```typescript
  // Request: { directory: string, board_id: number, task: string, agent?: string }
  // Response: { planner_session_id: string, epic_id: number }
  ```
  - Call `getNextTaskKey(board_id)` -> e.g. `"OK-1"`
  - Create opencode session (planner) via `POST ${OPENCODE_SERVER}/session`
  - Update session directory in DB
  - `createEpic(board_id, task, task, plannerSessionId)` with `status='planning'`
  - Build parts array with rules + decomposition prompt (see Flow section)
  - Send via `prompt_async`
  - Emit SSE `epic_updated`
  - Return `{ planner_session_id, epic_id }`

  `POST /api/sessions/swarm/spawn` - Spawn subtask sessions:
  ```typescript
  // Request: {
  //   directory: string,
  //   board_id: number,
  //   epic_id: number,
  //   subtasks: Array<{title: string, description: string}>,
  //   original_task: string,
  //   agent?: string
  // }
  // Response: { sessions: Array<{id: string, task_key: string, title: string}> }
  ```
  - Get epic from DB, validate it exists
  - Update epic: `status='spawning'`
  - For each subtask (i = 0..N):
    - Create opencode session via `POST ${OPENCODE_SERVER}/session`
    - Update session directory
    - Compute child key: `epic.task_key + "." + (i+1)` -> e.g. `"OK-1.3"`
    - Send subtask prompt with original context
    - `addEpicSession(epic_id, sessionId, childKey, i, title, description)`
    - Emit SSE `epic_updated`
  - Update epic: `status='running'`, `column_name='In Progress'`
  - `markSessionCompleted(plannerSessionId)`
  - Emit SSE `epic_updated`
  - Return spawned sessions list

  `GET /api/epics/:epicId` - Get epic detail:
  ```typescript
  // Response: Epic (with populated sessions + is_busy from opencode statuses)
  ```
  - Get epic from DB
  - Get all epic sessions
  - Fetch opencode session statuses
  - Populate `is_busy` for each session
  - Return populated epic

  `GET /api/boards/:id` - Update existing endpoint:
  - `getBoardFull` already returns epics (updated in TASK 2)
  - Also populate `is_busy` for epic sessions from opencode statuses

- **Depends on:** TASK 2
- **Conflicts:** None

---

### TASK 4: Frontend - Epic card component

- **Agent:** @builder
- **Files:**
  - `web/src/components/epic-card.tsx` (NEW)
  - `web/src/components/kanban-column.tsx` (MODIFY)
  - `web/src/types.ts` (MODIFY - add Epic, EpicSession, SwarmSubtask; update BoardFull)
- **Brief:**

  **Types** (`web/src/types.ts`):
  - Add `Epic`, `EpicSession`, `SwarmSubtask` interfaces (see Data Model section)
  - Update `BoardFull` to include `epics: Epic[]`

  **EpicCard component** (`epic-card.tsx`):

  Props:
  ```typescript
  interface EpicCardProps {
    epic: Epic;
    onClick?: () => void;
  }
  ```

  Visual design:
  - Distinct from regular cards: amber/purple left border (3px), slightly larger padding
  - Top row: task key badge (`OK-1`, prominent, amber background) + status indicator
  - Title (the original task)
  - Description (truncated, 2 lines)
  - Progress bar (using existing `Progress` component) with count: `3/5`
  - Bottom row: date + status text
  - Different background tint: `bg-amber-500/5` or similar

  Status indicators:
  - `planning` -> Spinner + "Planning..."
  - `spawning` -> Spinner + "Creating sessions..."
  - `running` -> Blue pulse + "Running"
  - `completed` -> Green checkmark + "Completed"
  - `failed` -> Red X + "Failed"

  **KanbanColumn** (`kanban-column.tsx`):

  Updated props:
  ```typescript
  interface KanbanColumnProps {
    column: Column;
    cards: Card[];
    epics: Epic[];           // NEW
    onCardClick?: (sessionId: string) => void;
    onEpicClick?: (epicId: number) => void;  // NEW
  }
  ```

  Changes:
  - Merge `cards` and `epics` into a single sorted list by `updated_at` (descending)
  - Render `<EpicCard>` for epics, `<KanbanCard>` for cards
  - Epics have `onEpicClick`, cards have `onCardClick`

- **Depends on:** TASK 2
- **Conflicts:** None

---

### TASK 5: Frontend - Swarm status panel

- **Agent:** @builder
- **Files:**
  - `web/src/components/swarm-status-panel.tsx` (NEW)
  - `web/src/main.tsx` (MODIFY - add epic selection state + conditional rendering)
  - `web/src/components/kanban-board.tsx` (MODIFY - pass epics + onEpicClick)
  - `web/src/hooks/use-kanban.ts` (MODIFY - include epics in BoardFull fetch)
- **Brief:**

  **SwarmStatusPanel** (`swarm-status-panel.tsx`):

  Props:
  ```typescript
  interface SwarmStatusPanelProps {
    epicId: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSessionClick: (sessionId: string) => void;
  }
  ```

  Layout (right-side panel, same dimensions/resize as SessionDetail):
  ```
  +--------------------------------------------------+
  | OK-1: Build a blog system               x Close  |
  | "Create a full blog with user auth..."           |
  |                                                   |
  | -----------------------------------------------  |
  | Progress: ████████████░░░░ 3/5 completed          |
  | Status: Running                                   |
  |                                                   |
  | +----------------------------------------------+ |
  | | OK-1.1  done  Create user model      [view]  | |
  | | OK-1.2  done  Build posts API        [view]  | |
  | | OK-1.3  busy  Add authentication     [view]  | |
  | | OK-1.4  idle  Write tests            [view]  | |
  | | OK-1.5  idle  Add documentation      [view]  | |
  | +----------------------------------------------+ |
  |                                                   |
  | -----------------------------------------------  |
  | v Plan Details (collapsible)                      |
  | The planner analyzed the task and decided...      |
  +--------------------------------------------------+
  ```

  Features:
  - Fetches epic from `GET /api/epics/:epicId`
  - Polls every 2s to refresh child statuses
  - Each child row: task key badge, status icon, title, "view" button
  - "view" button calls `onSessionClick(sessionId)`
  - Plan Details section uses Collapsible + MarkdownContent (reuse from session-detail)
  - Resize handle (same as SessionDetail)
  - Same slide-in animation as SessionDetail

  **main.tsx** changes:

  New state:
  ```typescript
  const [selectedEpicId, setSelectedEpicId] = useState<number | null>(null);
  ```

  Event handling:
  - Epic card clicked: `setSelectedEpicId(epicId)`, clear `selectedSession`
  - Regular card clicked: `setSelectedSession(id)`, clear `selectedEpicId`
  - Child session clicked from SwarmStatusPanel: `setSelectedSession(id)`, clear `selectedEpicId`

  Rendering:
  ```tsx
  {selectedSession && (
    <SessionDetail sessionId={selectedSession} open={true} ... />
  )}
  {selectedEpicId && !selectedSession && (
    <SwarmStatusPanel epicId={selectedEpicId} open={true} ... />
  )}
  ```

  **kanban-board.tsx** changes:
  - Accept and pass `epics` array to columns
  - Add `onEpicClick` prop

  **use-kanban.ts** changes:
  - `BoardFull` type now includes `epics`
  - No code changes needed if `fetchBoardFull` returns the full JSON (which it does)

- **Depends on:** TASK 3, TASK 4
- **Conflicts:** None

---

### TASK 6: Frontend - Swarm mode in SessionDetail

- **Agent:** @builder
- **Files:**
  - `web/src/components/session-detail.tsx` (MODIFY)
- **Brief:**

  **New state:**
  ```typescript
  const [swarmMode, setSwarmMode] = useState(false);
  const [swarmPhase, setSwarmPhase] = useState<'idle' | 'planning' | 'reviewing' | 'spawning'>('idle');
  const [swarmPlannerId, setSwarmPlannerId] = useState<string | null>(null);
  const [swarmEpicId, setSwarmEpicId] = useState<number | null>(null);
  const [swarmSubtasks, setSwarmSubtasks] = useState<SwarmSubtask[]>([]);
  const [swarmOriginalTask, setSwarmOriginalTask] = useState('');
  ```

  **New prop:**
  ```typescript
  interface SessionDetailProps {
    // ... existing props ...
    onEpicCreated?: (epicId: number) => void;  // NEW
  }
  ```

  **Switch toggle UI** (bottom bar, left side, only when `isNewSession`):
  ```tsx
  {isNewSession && (
    <div className="flex items-center gap-1.5">
      <Switch
        checked={swarmMode}
        onCheckedChange={setSwarmMode}
        className="data-[state=checked]:bg-amber-500"
      />
      <span className="text-xs flex items-center gap-1">
        <span role="img" aria-label="swarm">🐝</span> Swarm
      </span>
    </div>
  )}
  ```

  **Modified `sendMessage`** (when `swarmMode` is ON):
  - Call `POST /api/sessions/swarm` instead of normal create+send
  - Set `swarmPhase = 'planning'`, store `swarmPlannerId`, `swarmEpicId`, `swarmOriginalTask`
  - Panel shows planner session messages in real-time (existing polling works)
  - Optimistic message still shown in the chat

  **Planning phase detection** (in polling useEffect):
  - When `swarmPhase === 'planning'` and data has assistant messages:
    - Scan last assistant message for `<swarm-plan>([\s\S]*?)<\/swarm-plan>` regex
    - Parse extracted string as JSON array
    - Validate it's an array of `{ title: string, description: string }`
    - If valid: `setSwarmSubtasks(parsed)`, `setSwarmPhase('reviewing')`
    - If invalid: show error with raw response

  **Reviewing phase UI** (rendered below the message area):
  - Styled panel:
    ```
    +------------------------------------------+
    | Swarm Plan: OK-1 - 5 subtasks identified |
    |                                          |
    | 1. Create user model                     |
    |    Set up User with name, email...       |
    | 2. Build REST API                        |
    |    Create endpoints for CRUD...          |
    | 3. Add authentication                    |
    |    Implement JWT-based auth...           |
    | 4. Write tests                           |
    |    Unit and integration tests...         |
    | 5. Add documentation                     |
    |    API docs and README updates...        |
    |                                          |
    | [Spawn 5 Sessions]         [Cancel]      |
    +------------------------------------------+
    ```
  - Background: `bg-amber-500/5` with `border-amber-500/20`
  - Each subtask shows title + truncated description
  - "Spawn N Sessions" button (amber themed)
  - "Cancel" button (destructive)

  **Spawn handler** (on "Spawn N Sessions" click):
  - `setSwarmPhase('spawning')`
  - Show spinner: "Creating sessions..."
  - Call `POST /api/sessions/swarm/spawn`
  - On success:
    - Call `onEpicCreated?.(swarmEpicId)` to signal parent
    - `onOpenChange(false)` to close session detail
    - Parent (main.tsx) sets `selectedEpicId = swarmEpicId`
    - SwarmStatusPanel opens automatically
  - On failure: show error with retry button

  **Cleanup:**
  - Reset all swarm state when panel closes
  - Reset when `isNewSession` changes

- **Depends on:** TASK 1, TASK 3, TASK 5
- **Conflicts:** None

---

### TASK 7: Polish - Error handling, edge cases, SSE integration

- **Agent:** @builder
- **Files:**
  - `web/src/components/session-detail.tsx` (MODIFY)
  - `web/src/components/swarm-status-panel.tsx` (MODIFY)
  - `web/src/components/epic-card.tsx` (MODIFY)
  - `src/web.ts` (MODIFY)
  - `src/event-bus.ts` (MODIFY)
- **Brief:**

  **Error handling in session-detail.tsx:**
  - Planner doesn't produce `<swarm-plan>` after response completes:
    - Show error: "Could not decompose task. Try rephrasing or disable Swarm."
    - Retry button: re-send the task to the planner
    - Cancel button: close panel, delete epic
  - Invalid JSON in `<swarm-plan>`:
    - Fallback extraction strategies:
      1. Look for fenced code block with JSON: ```json\n[...]\n```
      2. Look for raw `[` + `]` balanced array
    - If all fail: show error with raw response for user to inspect
  - Spawn partial failure:
    - Show "3/5 sessions created" with details of failures
    - Allow proceeding with partial swarm
  - Subtask count validation:
    - Reject < 2 subtasks: "Task too simple for swarm mode"
    - Reject > 10 subtasks: "Too many subtasks. Simplify the task."

  **SSE integration:**
  - `src/event-bus.ts`: Add `'epic_updated'` event type
  - Frontend SSE handler in `use-kanban.ts`:
    - When `epic_updated` event received, refetch board (epics included)
    - Epic card progress updates in real-time
  - `swarm-status-panel.tsx`:
    - Listen for `epic_updated` events to refresh child statuses
    - Show live status changes (busy -> idle -> completed)

  **Epic auto-status updates in `src/web.ts`:**
  - On `GET /api/epics/:epicId`:
    - Call `updateEpicStatus(epicId)` to auto-detect completion/failure
    - Return updated epic
  - On `GET /api/boards/:id`:
    - For each epic, call `updateEpicStatus()` to keep statuses current

  **Loading states:**
  - Skeleton for swarm breakdown panel during planning phase
  - Spinner + "Creating sessions 3/5..." during spawning phase
  - Epic card shimmer while first loading

  **Cancellation:**
  - Cancel button during planning:
    - Abort planner session via `POST /api/opencode/session/{id}/abort`
    - Delete epic from DB
    - Reset swarm state
  - Cancel button during reviewing:
    - Delete epic from DB
    - Reset swarm state

  **Edge cases:**
  - User closes panel during planning: planning continues in background, epic appears on board via SSE
  - User navigates away during spawning: spawning continues, epic updates via SSE
  - Epic with no children (spawn failed): show "failed" status with error message

- **Depends on:** TASK 5, TASK 6
- **Conflicts:** None

---

## Post-Plan Checklist

- [ ] `npm run build` (root) - TypeScript compilation passes
- [ ] `npm run build` (web/) - Vite build passes
- [ ] DB migration: verify new tables created on next startup (`CREATE TABLE IF NOT EXISTS`)
- [ ] Manual test: New Session -> Toggle Swarm -> Type task -> Verify planning starts
- [ ] Manual test: Planner returns breakdown -> Review phase shows subtask list
- [ ] Manual test: Click "Spawn N Sessions" -> Epic card (OK-1) appears on board
- [ ] Manual test: Epic card shows correct progress bar (0/5 initially)
- [ ] Manual test: Click epic -> SwarmStatusPanel opens with all children
- [ ] Manual test: Click child "view" -> Opens its SessionDetail
- [ ] Manual test: Task key auto-increments (OK-1, OK-2 on second swarm)
- [ ] Manual test: SSE -> Epic card progress updates as children complete/fail
- [ ] Manual test: Epic auto-moves to Done when all children complete
- [ ] Manual test: Error case -> planner fails to produce breakdown -> retry works
- [ ] Manual test: Cancel during planning -> epic deleted, board clean

---

## Risk Flags

| Risk | Severity | Mitigation |
|------|----------|------------|
| Planner unreliable structured output | **HIGH** | Strict prompt + fallback extraction (code block, raw array) + clear error UI with retry |
| Board clutter with many epics | **MEDIUM** | Children hidden inside epic; only epic card on board; epics move to Done when complete |
| Task key collision | **LOW** | DB unique constraint on `(board_id, task_key)` |
| SSE events for epic updates not triggering | **MEDIUM** | Fallback: polling refreshes epics every 5s (already exists for board) |
| Epic status auto-update lag | **LOW** | Update on every board fetch + SSE event + status panel polling |
| Spawn endpoint timeout with many sessions | **MEDIUM** | Create sessions sequentially with progress, not batch; cap at 8 subtasks |
| opencode server overloaded with parallel sessions | **LOW** | Cap at 8 subtasks; sequential spawn to avoid burst |

---

## Decision Log

| Decision | Choice | Rationale | Date |
|----------|--------|-----------|------|
| Board representation | Epic card only | Children accessible through epic. Keeps board clean. | 2026-05-04 |
| Decomposition strategy | AI Planner agent | Smart decomposition, handles ambiguity naturally. | 2026-05-04 |
| Post-submit panel | Stay open, show progress | User wants to observe the full lifecycle. | 2026-05-04 |
| Confirm step | Manual "Spawn N Sessions" button | User reviews breakdown before committing resources. | 2026-05-04 |
| Planner session | Auto-complete after spawning | Planner served its purpose; epic tracks the swarm. | 2026-05-04 |
| Task key prefix | Auto from board name | Zero config, predictable, unique per board. | 2026-05-04 |
| Swarm status view location | Session detail panel (reuse) | Consistent UX, same interaction pattern. | 2026-05-04 |
| Children on board | Hidden inside epic | Prevents board clutter, epic is single source of truth. | 2026-05-04 |
| Structured output format | `<swarm-plan>` XML marker | Reliable extraction, still human-readable. | 2026-05-04 |
| Epic entity | Kanban-native (not opencode session) | Epics are board concepts, independent of session lifecycle. | 2026-05-04 |
