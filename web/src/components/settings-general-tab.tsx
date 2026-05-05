import { useState, useEffect, useCallback } from "react";
import { Loader2, RotateCcw, Settings, Shrink, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface GeneralSettingsData {
  auto_compact_enabled: boolean;
  auto_compact_threshold: number;
}

const DEFAULTS: GeneralSettingsData = {
  auto_compact_enabled: true,
  auto_compact_threshold: 80,
};

export default function SettingsGeneralTab() {
  const [settings, setSettings] = useState<GeneralSettingsData>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reloading, setReloading] = useState(false);

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
        });
      } catch (err) {
        toast.error("Failed to load settings");
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleToggle = useCallback((field: keyof GeneralSettingsData) => {
    setSettings((prev) => ({ ...prev, [field]: !prev[field] }));
    setDirty(true);
  }, []);

  const handleThresholdChange = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(100, value));
    setSettings((prev) => ({ ...prev, auto_compact_threshold: clamped }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auto_compact_enabled: String(settings.auto_compact_enabled),
          auto_compact_threshold: String(settings.auto_compact_threshold),
        }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setDirty(false);
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }, [settings]);

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
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            <h3 className="text-sm font-semibold">General</h3>
          </div>
          <p className="text-xs text-muted-foreground max-w-md">
            Configure workspace behavior and automation settings.
          </p>
        </div>
        <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

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
