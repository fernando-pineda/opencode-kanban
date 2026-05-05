import { useState, useEffect, useCallback } from "react";
import { Bot, Cpu, Save, Loader2 } from "lucide-react";
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
  onContentChange: (name: string, content: string) => void;
  onSave: (name: string) => void;
}

function AgentCard({ agent, content, fileExists, isDirty, isSaving, onContentChange, onSave }: AgentCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
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
  );
}

interface AgentsListProps {
  agents: AgentInfo[];
  agentFiles: Record<string, string>;
  agentFileExists: Record<string, boolean>;
  dirtyFiles: Set<string>;
  saving: Record<string, boolean>;
  onContentChange: (name: string, content: string) => void;
  onSave: (name: string) => void;
}

export function AgentsList({ agents, agentFiles, agentFileExists, dirtyFiles, saving, onContentChange, onSave }: AgentsListProps) {
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
          onContentChange={onContentChange}
          onSave={onSave}
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
    handleContentChange,
    handleSave,
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
