import { useState, useEffect, useCallback, useRef } from "react";

import { Bot, Cpu, Save, Loader2, Trash2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

export interface AgentInfo {
  name: string;
  mode: string;
  description: string;
  hidden: boolean;
  native: boolean;
  model: { providerID: string; modelID: string } | null;
}

export interface ModelInfo {
  providerID: string;
  modelID: string;
  name: string;
}

// ── Agent Card ───────────────────────────────────────────────

interface AgentCardProps {
  agent: AgentInfo;
  content: string;
  fileExists: boolean;
  isDirty: boolean;
  isSaving: boolean;
  canDelete: boolean;
  isDeleting: boolean;
  onContentChange: (name: string, content: string) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
}

function AgentCard({ agent, content, fileExists, isDirty, isSaving, canDelete, isDeleting, onContentChange, onSave, onDelete }: AgentCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <div className={`rounded-lg border bg-card p-4 space-y-3${confirmDelete ? " pointer-events-none" : ""}`}>
        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-semibold capitalize">{agent.name}</span>
            <Badge variant={agent.mode === "primary" ? "secondary" : "outline"}>
              {agent.mode === "primary" ? "Primary" : "Subagent"}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {agent.native ? (
              <Badge variant="outline" className="text-[10px]">
                Native
              </Badge>
            ) : agent.model ? (
              <Badge variant="outline" className="text-[10px] font-mono">
                <Cpu className="h-3 w-3 mr-1" />
                {agent.model.modelID}
              </Badge>
            ) : null}
          </div>
        </div>

        {/* Description */}
        {agent.description && (
          <p className="text-xs text-muted-foreground">{agent.description}</p>
        )}

        {/* Editor */}
        {!fileExists && (
          <p className="text-xs text-muted-foreground italic">
            No agent file on disk. Editing will create a new file.
          </p>
        )}
        <textarea
          value={content}
          onChange={(e) => onContentChange(agent.name, e.target.value)}
          className="w-full min-h-[200px] max-h-[400px] text-xs font-mono bg-muted rounded-md p-3 border resize-y focus:ring-1 focus:ring-ring outline-none"
          spellCheck={false}
          placeholder={fileExists ? "" : "# Edit to create a new agent file..."}
        />

        {/* Action bar */}
        <div className="flex items-center justify-between">
          {isDirty && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
          {!agent.native && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={!canDelete || isDeleting}
              onClick={() => setConfirmDelete(true)}
            >
              {isDeleting ? (
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3 mr-1.5" />
              )}
              Delete
            </Button>
          )}
          <div className="ml-auto">
            <Button size="sm" disabled={!isDirty || isSaving} onClick={() => onSave(agent.name)}>
              {isSaving ? (
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
              ) : (
                <Save className="h-3 w-3 mr-1.5" />
              )}
              Save
            </Button>
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <div className="bg-popover text-popover-foreground rounded-lg border p-4 shadow-lg max-w-sm mx-4 space-y-3">
            <h3 className="font-semibold text-sm">Delete agent</h3>
            <p className="text-sm text-muted-foreground">
              Delete the <strong className="capitalize">{agent.name}</strong> agent? This will remove its configuration file. The agent may still appear if it's registered by opencode.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setConfirmDelete(false);
                  onDelete(agent.name);
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Model Selector ───────────────────────────────────────────

function ModelSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/models").then(r => r.json()).then(setModels).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = models.filter(m =>
    m.name.toLowerCase().includes(filter.toLowerCase()) ||
    m.modelID.toLowerCase().includes(filter.toLowerCase()) ||
    m.providerID.toLowerCase().includes(filter.toLowerCase())
  );

  // Group by provider
  const grouped = filtered.reduce((acc, m) => {
    const key = m.providerID;
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {} as Record<string, ModelInfo[]>);

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        className="w-full text-xs bg-muted rounded-md px-3 py-2 border focus:ring-1 focus:ring-ring outline-none"
        placeholder="Search models..."
        value={open ? filter : (value || "")}
        onChange={(e) => { setFilter(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setFilter(value || ""); }}
      />
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {value && (
            <button
              className="w-full text-left text-xs px-3 py-1.5 hover:bg-accent text-muted-foreground"
              onClick={() => { onChange(""); setOpen(false); }}
            >
              Clear selection
            </button>
          )}
          {Object.entries(grouped).map(([provider, pModels]) => (
            <div key={provider}>
              <div className="text-[10px] font-semibold text-muted-foreground px-3 py-1 bg-muted/50">{provider}</div>
              {pModels.map(m => (
                <button
                  key={`${m.providerID}/${m.modelID}`}
                  className="w-full text-left text-xs px-3 py-1.5 hover:bg-accent truncate"
                  onClick={() => { onChange(`${m.providerID}/${m.modelID}`); setOpen(false); }}
                >
                  {m.name}
                </button>
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-xs text-muted-foreground px-3 py-2">No models found</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Create Agent Form ────────────────────────────────────────

export interface CreateAgentInfo {
  name: string;
  mode: "primary" | "subagent";
  description?: string;
  model?: string;
}

interface CreateAgentFormProps {
  mode: "primary" | "subagent";
  onCreated: (info: CreateAgentInfo) => void;
}

function CreateAgentForm({ mode, onCreated }: CreateAgentFormProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(name.trim())) { setError("Name can only contain letters, numbers, hyphens, and underscores"); return; }

    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          mode,
          description: description.trim() || undefined,
          model: model || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed: ${res.status}`);
      }
      toast.success(`Agent "${name.trim()}" created`);
      onCreated({
        name: name.trim(),
        mode,
        description: description.trim() || undefined,
        model: model || undefined,
      });
      // Reset form
      setName("");
      setDescription("");
      setModel("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setCreating(false);
    }
  };

  if (!open) {
    return (
      <button
        className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-2 rounded-md border border-dashed hover:border-solid transition-colors"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-3.5 w-3.5" />
        Add {mode === "primary" ? "Agent" : "Subagent"}
      </button>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">New {mode === "primary" ? "Agent" : "Subagent"}</h4>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setOpen(false); setError(null); }}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="space-y-2">
        <div>
          <label className="text-xs text-muted-foreground">Name</label>
          <input
            type="text"
            className="w-full text-xs bg-muted rounded-md px-3 py-2 border focus:ring-1 focus:ring-ring outline-none"
            placeholder="my-agent"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Description</label>
          <input
            type="text"
            className="w-full text-xs bg-muted rounded-md px-3 py-2 border focus:ring-1 focus:ring-ring outline-none"
            placeholder="What this agent does..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Model</label>
          <ModelSelector value={model} onChange={setModel} />
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => { setOpen(false); setError(null); }}>
          Cancel
        </Button>
        <Button size="sm" disabled={creating || !name.trim()} onClick={handleCreate}>
          {creating ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Plus className="h-3 w-3 mr-1.5" />}
          Create
        </Button>
      </div>
    </div>
  );
}

// ── Agents List ──────────────────────────────────────────────

interface AgentsListProps {
  agents: AgentInfo[];
  agentFiles: Record<string, string>;
  agentFileExists: Record<string, boolean>;
  dirtyFiles: Set<string>;
  saving: Record<string, boolean>;
  deleting: Record<string, boolean>;
  mode: "primary" | "subagent";
  onContentChange: (name: string, content: string) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
  onAgentCreated: (info: CreateAgentInfo) => void;
}

export function AgentsList({ agents, agentFiles, agentFileExists, dirtyFiles, saving, deleting, mode, onContentChange, onSave, onDelete, onAgentCreated }: AgentsListProps) {
  if (agents.length === 0) {
    return (
      <div className="space-y-3">
        <CreateAgentForm mode={mode} onCreated={onAgentCreated} />
        <div className="text-sm text-muted-foreground text-center py-8">
          No {mode === "primary" ? "agents" : "subagents"} found. Create one!
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <CreateAgentForm mode={mode} onCreated={onAgentCreated} />
      {agents.map((agent) => (
        <AgentCard
          key={agent.name}
          agent={agent}
          content={agentFiles[agent.name] || ""}
          fileExists={agentFileExists[agent.name] !== false}
          isDirty={dirtyFiles.has(agent.name)}
          isSaving={saving[agent.name] || false}
          canDelete={agents.length > 1}
          isDeleting={deleting[agent.name] || false}
          onContentChange={onContentChange}
          onSave={onSave}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

// ── Shared hook ─────────────────────────────────────────────

export function useAgentsData() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentFiles, setAgentFiles] = useState<Record<string, string>>({});
  const [agentFileExists, setAgentFileExists] = useState<Record<string, boolean>>({});
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [hiddenAgents, setHiddenAgents] = useState<string[]>([]);

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        setLoading(true);
        setError(null);
        const [agentRes, hiddenRes, diskRes] = await Promise.all([
          fetch("/api/opencode/agent"),
          fetch("/api/agents/hidden"),
          fetch("/api/agents"),
        ]);
        if (!agentRes.ok) throw new Error(`Failed to fetch agents: ${agentRes.status}`);
        const opencodeAgents: AgentInfo[] = await agentRes.json();
        const hiddenData = hiddenRes.ok ? await hiddenRes.json() : { hidden: [] };
        const hidden = (hiddenData.hidden || []) as string[];
        setHiddenAgents(hidden);

        // Merge: opencode agents are the base, then add disk-only agents
        // that opencode hasn't loaded yet (e.g. just-created .md files)
        const opencodeNames = new Set(opencodeAgents.map((a) => a.name));
        let merged = [...opencodeAgents];

        if (diskRes.ok) {
          const diskAgents = await diskRes.json() as Array<{
            name: string;
            mode: string;
            description: string;
            model: string | null;
          }>;
          for (const da of diskAgents) {
            if (!opencodeNames.has(da.name)) {
              const modelParts = da.model ? da.model.split("/") : null;
              merged.push({
                name: da.name,
                mode: da.mode,
                description: da.description,
                hidden: false,
                native: false,
                model: modelParts && modelParts.length === 2
                  ? { providerID: modelParts[0], modelID: modelParts[1] }
                  : null,
              });
            }
          }
        }

        setAgents(merged);

        // Fetch file content for each visible agent in parallel
        const visible = merged.filter((a: AgentInfo) => a.hidden !== true && !hidden.includes(a.name));
        const entries = visible.map(async (agent: AgentInfo) => {
            try {
              const fileRes = await fetch(`/api/agents/${agent.name}/file`);
              if (fileRes.ok) {
                const fileData = await fileRes.json();
                return { name: agent.name, content: fileData.content || "", exists: fileData.exists !== false };
              }
            } catch {
              // non-critical
            }
            return { name: agent.name, content: "", exists: false };
          });

        const results = await Promise.all(entries);
        const files: Record<string, string> = {};
        const exists: Record<string, boolean> = {};
        for (const { name, content, exists: e } of results) {
          files[name] = content;
          exists[name] = e;
        }
        setAgentFiles(files);
        setAgentFileExists(exists);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        toast.error(`Failed to load agents: ${message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchAgents();
  }, []);

  const handleContentChange = useCallback((name: string, content: string) => {
    setAgentFiles((prev) => ({ ...prev, [name]: content }));
    setDirtyFiles((prev) => new Set(prev).add(name));
  }, []);

  const handleSave = useCallback(async (agentName: string) => {
    setSaving((prev) => ({ ...prev, [agentName]: true }));
    try {
      const res = await fetch(`/api/agents/${agentName}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: agentFiles[agentName] }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setDirtyFiles((prev) => {
        const next = new Set(prev);
        next.delete(agentName);
        return next;
      });
      toast.success(`Agent "${agentName}" saved successfully`);
    } catch {
      toast.error(`Failed to save agent "${agentName}"`);
    } finally {
      setSaving((prev) => ({ ...prev, [agentName]: false }));
    }
  }, [agentFiles]);

  const handleDelete = useCallback(async (agentName: string) => {
    setDeleting((prev) => ({ ...prev, [agentName]: true }));
    try {
      const res = await fetch(`/api/agents/${agentName}/file`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      // Remove agent from local state
      setAgents((prev) => prev.filter((a) => a.name !== agentName));
      // Clean up file state
      setAgentFiles((prev) => {
        const next = { ...prev };
        delete next[agentName];
        return next;
      });
      setAgentFileExists((prev) => {
        const next = { ...prev };
        delete next[agentName];
        return next;
      });
      setDirtyFiles((prev) => {
        const next = new Set(prev);
        next.delete(agentName);
        return next;
      });
      toast.success(`Agent "${agentName}" deleted`);
    } catch {
      toast.error(`Failed to delete agent "${agentName}"`);
    } finally {
      setDeleting((prev) => ({ ...prev, [agentName]: false }));
    }
  }, []);

  const handleAgentCreated = useCallback(async (info: CreateAgentInfo) => {
    // Optimistically add the new agent to local state.
    // Opencode caches agents in memory and won't pick up new .md files
    // until restarted, so we can't rely on /api/opencode/agent here.
    const modelParts = info.model ? info.model.split("/") : null;
    const newAgent: AgentInfo = {
      name: info.name,
      mode: info.mode,
      description: info.description || info.name,
      hidden: false,
      native: false,
      model: modelParts && modelParts.length === 2
        ? { providerID: modelParts[0], modelID: modelParts[1] }
        : null,
    };
    setAgents(prev => {
      if (prev.some(a => a.name === info.name)) return prev;
      return [...prev, newAgent];
    });

    // Fetch the new agent's file content for the editor
    try {
      const fileRes = await fetch(`/api/agents/${info.name}/file`);
      if (fileRes.ok) {
        const fileData = await fileRes.json();
        setAgentFiles(prev => ({ ...prev, [info.name]: fileData.content || "" }));
        setAgentFileExists(prev => ({ ...prev, [info.name]: fileData.exists !== false }));
      }
    } catch {
      // non-critical
    }
  }, []);

  const visibleAgents = agents.filter((a) => a.hidden !== true && !hiddenAgents.includes(a.name));
  const primaryAgents = visibleAgents.filter((a) => a.mode === "primary");
  const subagents = visibleAgents.filter((a) => a.mode === "subagent");

  return {
    loading,
    error,
    primaryAgents,
    subagents,
    agentFiles,
    agentFileExists,
    dirtyFiles,
    saving,
    deleting,
    handleContentChange,
    handleSave,
    handleDelete,
    handleAgentCreated,
  };
}

// ── Loading / error shells ──────────────────────────────────

export function AgentsLoadingSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-48 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}

export function AgentsError({ error }: { error: string }) {
  return (
    <div className="text-sm text-destructive">Failed to load agents: {error}</div>
  );
}
