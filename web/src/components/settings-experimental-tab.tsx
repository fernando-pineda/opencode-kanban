import { useState, useEffect } from "react";
import {
  AlertTriangle,
  Plus,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface Rule {
  id: number;
  title: string;
  content: string;
  position: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export default function SettingsExperimentalTab() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [localEdits, setLocalEdits] = useState<
    Record<number, { title?: string; content?: string }>
  >({});

  // Fetch rules on mount
  useEffect(() => {
    const fetchRules = async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/rules");
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const data = await res.json();
        setRules(data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };
    fetchRules();
  }, []);

  // Get effective value: local edit if exists, otherwise server value
  const getValue = (rule: Rule, field: "title" | "content") => {
    return localEdits[rule.id]?.[field] ?? rule[field];
  };

  // Local onChange — no fetch, just update local state
  const handleLocalChange = (
    ruleId: number,
    field: "title" | "content",
    value: string,
  ) => {
    setLocalEdits((prev) => ({
      ...prev,
      [ruleId]: { ...prev[ruleId], [field]: value },
    }));
  };

  // Sync to backend on blur — clear local edit on success
  const handleBlur = async (ruleId: number) => {
    const edit = localEdits[ruleId];
    if (!edit) return;
    setSavingId(ruleId);
    try {
      const res = await fetch(`/api/rules/${ruleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edit),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const updated = await res.json();
      setRules((prev) => prev.map((r) => (r.id === ruleId ? updated : r)));
      setLocalEdits((prev) => {
        const next = { ...prev };
        delete next[ruleId];
        return next;
      });
    } catch {
      toast.error("Failed to save rule");
    } finally {
      setSavingId(null);
    }
  };

  // Add rule
  const handleAdd = async () => {
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Rule", content: "", enabled: true }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const rule = await res.json();
      setRules((prev) => [...prev, rule]);
      // Clear any localEdits for this rule (shouldn't be needed but clean)
      setLocalEdits((prev) => {
        const next = { ...prev };
        delete next[rule.id];
        return next;
      });
      toast.success("Rule added");
    } catch {
      toast.error("Failed to add rule");
    }
  };

  // Delete rule
  const handleDelete = async (ruleId: number) => {
    try {
      const res = await fetch(`/api/rules/${ruleId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
      setLocalEdits((prev) => {
        const next = { ...prev };
        delete next[ruleId];
        return next;
      });
      toast.success("Rule deleted");
    } catch {
      toast.error("Failed to delete rule");
    }
  };

  // Toggle rule enabled/disabled
  const handleToggle = async (ruleId: number, enabled: boolean) => {
    try {
      const res = await fetch(`/api/rules/${ruleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const updated = await res.json();
      setRules((prev) => prev.map((r) => (r.id === ruleId ? updated : r)));
    } catch {
      toast.error("Failed to toggle rule");
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="text-sm text-destructive">
        Failed to load rules: {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold">Rules</h3>
          </div>
          <p className="text-xs text-muted-foreground max-w-md">
            Rules are injected into every message as &lt;mandatory&gt; tags.
            They are not shown in the chat bubbles.
          </p>
        </div>
        <Button size="sm" onClick={handleAdd}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Rule
        </Button>
      </div>

      {/* Rules list */}
      <div className="space-y-3">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="rounded-lg border bg-card p-4 space-y-3"
          >
            {/* Header row */}
            <div className="flex items-center justify-between gap-2">
              <input
                type="text"
                value={getValue(rule, "title")}
                onChange={(e) =>
                  handleLocalChange(rule.id, "title", e.target.value)
                }
                onBlur={() => handleBlur(rule.id)}
                className="flex-1 text-sm font-semibold bg-transparent border-none outline-none placeholder:text-muted-foreground focus:ring-0 p-0 min-w-0"
                placeholder="Rule title..."
              />
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant={rule.enabled ? "secondary" : "ghost"}
                  size="icon"
                  onClick={() => handleToggle(rule.id, !rule.enabled)}
                  title={rule.enabled ? "Disable" : "Enable"}
                  className="h-8 w-8"
                >
                  {rule.enabled ? (
                    <ToggleRight className="h-3.5 w-3.5" />
                  ) : (
                    <ToggleLeft className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(rule.id)}
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Content textarea */}
            <textarea
              value={getValue(rule, "content")}
              onChange={(e) =>
                handleLocalChange(rule.id, "content", e.target.value)
              }
              onBlur={() => handleBlur(rule.id)}
              className="w-full min-h-[100px] max-h-[300px] text-xs font-mono bg-muted rounded-md p-3 border resize-y focus:ring-1 focus:ring-ring outline-none"
              spellCheck={false}
              placeholder="Enter the rule content..."
            />
          </div>
        ))}
      </div>

      {/* Empty state */}
      {rules.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-8">
          No rules configured. Click "Add Rule" to create one.
        </div>
      )}
    </div>
  );
}
