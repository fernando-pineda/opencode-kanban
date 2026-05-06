import { useState, useEffect, useCallback } from "react";
import ReactDOM from "react-dom";
import { Bot, Cpu, Save, Loader2, Trash2 } from "lucide-react";
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
      {confirmDelete &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
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
          </div>,
          document.body,
        )}
    </>
  );
}

interface AgentsListProps {
  agents: AgentInfo[];
  agentFiles: Record<string, string>;
  agentFileExists: Record<string, boolean>;
  dirtyFiles: Set<string>;
  saving: Record<string, boolean>;
  deleting: Record<string, boolean>;
  onContentChange: (name: string, content: string) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
}

export function AgentsList({ agents, agentFiles, agentFileExists, dirtyFiles, saving, deleting, onContentChange, onSave, onDelete }: AgentsListProps) {
  if (agents.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        No agents found.
      </div>
    );
  }

  return (
    <div className="space-y-3">
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

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/opencode/agent");
        if (!res.ok) throw new Error(`Failed to fetch agents: ${res.status}`);
        const data = await res.json();
        setAgents(data || []);

        // Fetch file content for each visible agent in parallel
        const entries = (data || [])
          .filter((a: AgentInfo) => a.hidden !== true)
          .map(async (agent: AgentInfo) => {
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

  const primaryAgents = agents.filter((a) => a.mode === "primary" && a.hidden !== true);
  const subagents = agents.filter((a) => a.mode === "subagent" && a.hidden !== true);

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
