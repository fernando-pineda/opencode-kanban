<!-- opencode-kanban:start -->
# Global Agent Rules

## Memory System

You have access to `memory_*` and `knowledge_*` MCP tools via the kanban server. These persist context across sessions so future agents don't repeat your mistakes.

### Auto-loaded context
Repository knowledge and recent memories are automatically injected into every message you receive. You do NOT need to call `knowledge_list` or `memory_get` on session start — the context is already in your `<mandatory>` block.

### During work
- Before making architectural decisions: `knowledge_search({ repo_path, query })` to check for deeper knowledge
- When you discover something non-obvious: `memory_save({ repo_path, conversation_id, agent_name, memory_type, content, summary, importance })`
- When you learn repo structure, APIs, commands, gotchas: `knowledge_save({ repo_path, category, key, title, content })`

### Memory types
- `decision`: Architectural or design choices made (high importance)
- `finding`: Non-obvious discoveries about how things work (high importance)
- `pattern`: Recurring patterns in the codebase (medium importance)
- `error`: Bugs found, root causes, workarounds (high importance)
- `preference`: User-stated preferences for how things should be done (medium importance)
- `context`: General context about the session (low importance)

### Knowledge categories
- `file`: What a file does, exports, imports (key = file path)
- `command`: CLI commands — build, test, dev, deploy (key = command name)
- `architecture`: System design, layers, patterns (key = area name)
- `api`: Endpoints, params, responses (key = "METHOD /path")
- `config`: Env vars, setup, configuration (key = config area)
- `schema`: Database tables, columns, relationships (key = table name)
- `workflow`: How to do common tasks (key = workflow name)
- `gotcha`: Known pitfalls and workarounds (key = issue name)

### On session end
Ensure all important findings, decisions, and errors from this session have been saved. If the user says goodbye or the task is complete, save a final memory summarizing what was accomplished and any loose ends.
<!-- opencode-kanban:end -->
