import { useState, useEffect, useCallback } from "react";
import { Loader2, RotateCcw, Shrink, ToggleLeft, ToggleRight, Brain, FileText, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface GeneralSettingsData {
  auto_compact_enabled: boolean;
  auto_compact_threshold: number;
  memories_enabled: boolean;
  memories_auto_prune_days: number;
  memories_keep_important: boolean;
}

const DEFAULTS: GeneralSettingsData = {
  auto_compact_enabled: true,
  auto_compact_threshold: 80,
  memories_enabled: true,
  memories_auto_prune_days: 90,
  memories_keep_important: true,
};

export default function SettingsGeneralTab() {
  const [settings, setSettings] = useState<GeneralSettingsData>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [agentsMdContent, setAgentsMdContent] = useState("");
  const [agentsMdLoaded, setAgentsMdLoaded] = useState(false);
  const [agentsMdDirty, setAgentsMdDirty] = useState(false);
  const [agentsMdSaving, setAgentsMdSaving] = useState(false);

  // Fetch settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/settings");
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const data = await res.json();

        // Parse key/value array into object
        const map: Record<string, string> = {};
        for (const row of data) {
          map[row.key] = row.value;
        }

        setSettings({
          auto_compact_enabled:
            map.auto_compact_enabled !== undefined
              ? map.auto_compact_enabled === "true" || map.auto_compact_enabled === "1"
              : DEFAULTS.auto_compact_enabled,
          auto_compact_threshold: map.auto_compact_threshold
            ? parseInt(map.auto_compact_threshold, 10)
            : DEFAULTS.auto_compact_threshold,
          memories_enabled:
            map.memories_enabled !== undefined
              ? map.memories_enabled === "true" || map.memories_enabled === "1"
              : DEFAULTS.memories_enabled,
          memories_auto_prune_days: map.memories_auto_prune_days
            ? parseInt(map.memories_auto_prune_days, 10)
            : DEFAULTS.memories_auto_prune_days,
          memories_keep_important:
            map.memories_keep_important !== undefined
              ? map.memories_keep_important === "true" || map.memories_keep_important === "1"
              : DEFAULTS.memories_keep_important,
        });
      } catch (err) {
        toast.error("Failed to load settings");
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  // Fetch AGENTS.md on mount
  useEffect(() => {
    const fetchAgentsMd = async () => {
      try {
        const res = await fetch("/api/agents/global-file");
        if (res.ok) {
          const data = await res.json();
          setAgentsMdContent(data.content || "");
          setAgentsMdLoaded(true);
        }
      } catch {
        // non-critical
      }
    };
    fetchAgentsMd();
  }, []);

  const saveSettings = useCallback(async (newSettings: GeneralSettingsData) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auto_compact_enabled: String(newSettings.auto_compact_enabled),
          auto_compact_threshold: String(newSettings.auto_compact_threshold),
          memories_enabled: String(newSettings.memories_enabled),
          memories_auto_prune_days: String(newSettings.memories_auto_prune_days),
          memories_keep_important: String(newSettings.memories_keep_important),
        }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }, []);

  const handleToggle = useCallback((field: keyof GeneralSettingsData) => {
    setSettings((prev) => {
      const next = { ...prev, [field]: !prev[field] };
      saveSettings(next);
      return next;
    });
  }, [saveSettings]);

  const handleThresholdChange = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(100, value));
    setSettings((prev) => {
      const next = { ...prev, auto_compact_threshold: clamped };
      saveSettings(next);
      return next;
    });
  }, [saveSettings]);

  const handlePruneDaysChange = useCallback((value: number) => {
    const clamped = Math.max(1, Math.min(365, value));
    setSettings((prev) => {
      const next = { ...prev, memories_auto_prune_days: clamped };
      saveSettings(next);
      return next;
    });
  }, [saveSettings]);

  const handleReload = useCallback(async () => {
    setReloading(true);
    try {
      const res = await fetch("/api/reload", { method: "POST" });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      toast.success("Backend rebuilding & restarting…");
      // The server will restart, so we show a brief loading state
      // The page will naturally reconnect once the server is back
    } catch {
      toast.error("Failed to reload backend");
      setReloading(false);
    }
  }, []);

  const handleSaveAgentsMd = useCallback(async () => {
    setAgentsMdSaving(true);
    try {
      const res = await fetch("/api/agents/global-file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: agentsMdContent }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setAgentsMdDirty(false);
      toast.success("Global AGENTS.md saved");
    } catch {
      toast.error("Failed to save AGENTS.md");
    } finally {
      setAgentsMdSaving(false);
    }
  }, [agentsMdContent]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Auto-Compaction Card */}
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Shrink className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Auto-Compaction</span>
          </div>
          <Button
            variant={settings.auto_compact_enabled ? "secondary" : "ghost"}
            size="icon"
            onClick={() => handleToggle("auto_compact_enabled")}
            title={settings.auto_compact_enabled ? "Disable" : "Enable"}
            className="h-8 w-8"
          >
            {settings.auto_compact_enabled ? (
              <ToggleRight className="h-3.5 w-3.5" />
            ) : (
              <ToggleLeft className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Automatically compact session context when usage exceeds a threshold
          percentage of the model&apos;s context limit. This helps prevent hitting
          context limits during long sessions.
        </p>

        {/* Threshold slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">
              Compact at
            </label>
            <span className="text-xs font-mono tabular-nums">
              {settings.auto_compact_threshold}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={settings.auto_compact_threshold}
            onChange={(e) => handleThresholdChange(parseInt(e.target.value, 10))}
            disabled={!settings.auto_compact_enabled}
            className="w-full h-1.5 rounded-full appearance-none bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Disabled</span>
            <span>Conservative</span>
            <span>Aggressive</span>
          </div>
        </div>

        {/* Visual preview */}
        {settings.auto_compact_enabled && (
          <div className="pt-2 border-t">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary/60 transition-all"
                    style={{ width: `${settings.auto_compact_threshold}%` }}
                  />
                </div>
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                Triggers at {settings.auto_compact_threshold}% usage
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Memories Card */}
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Memories</span>
          </div>
          <Button
            variant={settings.memories_enabled ? "secondary" : "ghost"}
            size="icon"
            onClick={() => handleToggle("memories_enabled")}
            title={settings.memories_enabled ? "Disable" : "Enable"}
            className="h-8 w-8"
          >
            {settings.memories_enabled ? (
              <ToggleRight className="h-3.5 w-3.5" />
            ) : (
              <ToggleLeft className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Memories persist agent context across sessions. Conversation decisions,
          findings, patterns, and errors are saved and searchable.
        </p>

        {/* Auto-prune slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">
              Auto-prune after
            </label>
            <span className="text-xs font-mono tabular-nums">
              {settings.memories_auto_prune_days} days
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={365}
            step={1}
            value={settings.memories_auto_prune_days}
            onChange={(e) => handlePruneDaysChange(parseInt(e.target.value, 10))}
            disabled={!settings.memories_enabled}
            className="w-full h-1.5 rounded-full appearance-none bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>30 days</span>
            <span>180 days</span>
            <span>365 days</span>
          </div>
        </div>

        {/* Keep important memories checkbox */}
        <div className="pt-2 border-t">
          <button
            onClick={() => handleToggle("memories_keep_important")}
            disabled={!settings.memories_enabled}
            className="flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:text-foreground transition-colors text-muted-foreground"
          >
            <input
              type="checkbox"
              checked={settings.memories_keep_important}
              onChange={() => {}}
              disabled={!settings.memories_enabled}
              className="h-3.5 w-3.5 rounded border border-muted-foreground cursor-pointer"
            />
            <span className="text-xs font-medium">Keep important memories</span>
          </button>
        </div>
      </div>

      {/* Backend Card */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <RotateCcw className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Backend</span>
        </div>

        <p className="text-xs text-muted-foreground">
          Rebuild the TypeScript backend and restart the server. This compiles
          the latest source code and restarts the service. Active sessions will
          be briefly interrupted during the restart.
        </p>

        <Button
          size="sm"
          variant="outline"
          disabled={reloading}
          onClick={handleReload}
        >
          {reloading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Rebuilding…
            </>
          ) : (
            <>
              <RotateCcw className="h-3.5 w-3.5" />
              Rebuild &amp; Restart
            </>
          )}
        </Button>
      </div>

      {/* Global AGENTS.md Card */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Global Rules</span>
          <span className="text-[10px] text-muted-foreground font-mono">AGENTS.md</span>
        </div>

        <p className="text-xs text-muted-foreground">
          Global rules injected into every agent conversation. Edit the shared instructions that all agents receive.
        </p>

        <textarea
          value={agentsMdContent}
          onChange={(e) => { setAgentsMdContent(e.target.value); setAgentsMdDirty(true); }}
          className="w-full min-h-[200px] max-h-[400px] text-xs font-mono bg-muted rounded-md p-3 border resize-y focus:ring-1 focus:ring-ring outline-none"
          spellCheck={false}
          placeholder="# Global agent rules..."
        />

        <div className="flex items-center justify-between">
          {agentsMdDirty && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
          <div className="ml-auto">
            <Button size="sm" disabled={!agentsMdDirty || agentsMdSaving} onClick={handleSaveAgentsMd}>
              {agentsMdSaving ? (
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
              ) : (
                <Save className="h-3 w-3 mr-1.5" />
              )}
              Save
            </Button>
          </div>
        </div>
      </div>

      {/* Info box */}
      <div className="rounded-lg border border-dashed border-muted-foreground/20 bg-muted/20 p-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <strong>How it works:</strong> The backend monitors active sessions every 30 seconds.
          When a session&apos;s context token usage exceeds the threshold percentage of its
          model&apos;s context limit, compaction is automatically triggered via the opencode API.
          Set to 0% to disable.
        </p>
      </div>
    </div>
  );
}
