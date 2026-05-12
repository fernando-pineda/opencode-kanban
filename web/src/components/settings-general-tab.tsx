import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  RotateCcw,
  ToggleLeft,
  ToggleRight,
  Brain,
  Database,
  FileText,
  Save,
  Mic,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface GeneralSettingsData {
  memories_enabled: boolean;
  memories_auto_prune_days: number;
  memories_keep_important: boolean;
  file_indexing_enabled: boolean;
  file_indexing_aws_profile: string;
  file_indexing_aws_region: string;
  file_indexing_embedding_model: string;
  file_indexing_max_file_size: number;
  file_indexing_chunk_size: number;
  file_indexing_top_k: number;
}

const DEFAULTS: GeneralSettingsData = {
  memories_enabled: true,
  memories_auto_prune_days: 90,
  memories_keep_important: true,
  file_indexing_enabled: true,
  file_indexing_aws_profile: "default",
  file_indexing_aws_region: "us-east-1",
  file_indexing_embedding_model: "amazon.titan-embed-text-v2:0",
  file_indexing_max_file_size: 1048576,
  file_indexing_chunk_size: 2000,
  file_indexing_top_k: 5,
};

/** Whisper-supported languages (from the error message the model returns). */
const WHISPER_LANGUAGES = [
  { value: "any", label: "Auto-detect" },
  { value: "english", label: "English" },
  { value: "spanish", label: "Spanish" },
  { value: "french", label: "French" },
  { value: "german", label: "German" },
  { value: "italian", label: "Italian" },
  { value: "portuguese", label: "Portuguese" },
  { value: "chinese", label: "Chinese" },
  { value: "japanese", label: "Japanese" },
  { value: "korean", label: "Korean" },
  { value: "russian", label: "Russian" },
  { value: "arabic", label: "Arabic" },
  { value: "hindi", label: "Hindi" },
  { value: "dutch", label: "Dutch" },
  { value: "polish", label: "Polish" },
  { value: "turkish", label: "Turkish" },
  { value: "swedish", label: "Swedish" },
  { value: "ukrainian", label: "Ukrainian" },
  { value: "romanian", label: "Romanian" },
  { value: "greek", label: "Greek" },
  { value: "czech", label: "Czech" },
  { value: "finnish", label: "Finnish" },
  { value: "vietnamese", label: "Vietnamese" },
  { value: "thai", label: "Thai" },
  { value: "catalan", label: "Catalan" },
];

export default function SettingsGeneralTab() {
  const [settings, setSettings] = useState<GeneralSettingsData>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [agentsMdContent, setAgentsMdContent] = useState("");
  const [agentsMdLoaded, setAgentsMdLoaded] = useState(false);
  const [agentsMdDirty, setAgentsMdDirty] = useState(false);
  const [agentsMdSaving, setAgentsMdSaving] = useState(false);
  const [sttLanguage, setSttLanguage] = useState(() => {
    try {
      return localStorage.getItem("stt_language") || "any";
    } catch {
      return "any";
    }
  });
  const [awsProfiles, setAwsProfiles] = useState<string[]>([]);
  const [testingAws, setTestingAws] = useState(false);
  const [awsTestResult, setAwsTestResult] = useState<{
    ok: boolean;
    error?: string;
    model?: string;
    dimensions?: number;
  } | null>(null);

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
          memories_enabled:
            map.memories_enabled !== undefined
              ? map.memories_enabled === "true" || map.memories_enabled === "1"
              : DEFAULTS.memories_enabled,
          memories_auto_prune_days: map.memories_auto_prune_days
            ? parseInt(map.memories_auto_prune_days, 10)
            : DEFAULTS.memories_auto_prune_days,
          memories_keep_important:
            map.memories_keep_important !== undefined
              ? map.memories_keep_important === "true" ||
                map.memories_keep_important === "1"
              : DEFAULTS.memories_keep_important,
          file_indexing_enabled:
            map.file_indexing_enabled !== undefined
              ? map.file_indexing_enabled === "true" ||
                map.file_indexing_enabled === "1"
              : DEFAULTS.file_indexing_enabled,
          file_indexing_aws_profile:
            map.file_indexing_aws_profile || DEFAULTS.file_indexing_aws_profile,
          file_indexing_aws_region:
            map.file_indexing_aws_region || DEFAULTS.file_indexing_aws_region,
          file_indexing_embedding_model:
            map.file_indexing_embedding_model ||
            DEFAULTS.file_indexing_embedding_model,
          file_indexing_max_file_size: map.file_indexing_max_file_size
            ? parseInt(map.file_indexing_max_file_size, 10)
            : DEFAULTS.file_indexing_max_file_size,
          file_indexing_chunk_size: map.file_indexing_chunk_size
            ? parseInt(map.file_indexing_chunk_size, 10)
            : DEFAULTS.file_indexing_chunk_size,
          file_indexing_top_k: map.file_indexing_top_k
            ? parseInt(map.file_indexing_top_k, 10)
            : DEFAULTS.file_indexing_top_k,
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
          memories_enabled: String(newSettings.memories_enabled),
          memories_auto_prune_days: String(
            newSettings.memories_auto_prune_days,
          ),
          memories_keep_important: String(newSettings.memories_keep_important),
          file_indexing_enabled: String(newSettings.file_indexing_enabled),
          file_indexing_aws_profile: newSettings.file_indexing_aws_profile,
          file_indexing_aws_region: newSettings.file_indexing_aws_region,
          file_indexing_embedding_model:
            newSettings.file_indexing_embedding_model,
          file_indexing_max_file_size: String(
            newSettings.file_indexing_max_file_size,
          ),
          file_indexing_chunk_size: String(
            newSettings.file_indexing_chunk_size,
          ),
          file_indexing_top_k: String(newSettings.file_indexing_top_k),
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

  const handleToggle = useCallback(
    (field: keyof GeneralSettingsData) => {
      setSettings((prev) => {
        const next = { ...prev, [field]: !prev[field] };
        saveSettings(next);
        return next;
      });
    },
    [saveSettings],
  );

  const handlePruneDaysChange = useCallback(
    (value: number) => {
      const clamped = Math.max(1, Math.min(365, value));
      setSettings((prev) => {
        const next = { ...prev, memories_auto_prune_days: clamped };
        saveSettings(next);
        return next;
      });
    },
    [saveSettings],
  );

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

  const handleSttLanguageChange = useCallback((value: string) => {
    setSttLanguage(value);
    try {
      localStorage.setItem("stt_language", value);
    } catch {
      /* ignore */
    }
  }, []);

  const handleFetchAwsProfiles = useCallback(async () => {
    try {
      const res = await fetch("/api/indexing/aws-profiles");
      if (!res.ok) return;
      const data = await res.json();
      setAwsProfiles(data.profiles || []);
    } catch {
      // ignore
    }
  }, []);

  const handleTestAwsConnection = useCallback(async () => {
    setTestingAws(true);
    setAwsTestResult(null);
    try {
      const res = await fetch("/api/indexing/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: settings.file_indexing_aws_profile,
          region: settings.file_indexing_aws_region,
          model: settings.file_indexing_embedding_model,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAwsTestResult(data);
    } catch (err: any) {
      setAwsTestResult({ ok: false, error: err.message });
    } finally {
      setTestingAws(false);
    }
  }, [
    settings.file_indexing_aws_profile,
    settings.file_indexing_aws_region,
    settings.file_indexing_embedding_model,
  ]);

  useEffect(() => {
    if (settings.file_indexing_enabled) {
      handleFetchAwsProfiles();
    }
  }, [settings.file_indexing_enabled, handleFetchAwsProfiles]);

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
          Memories persist agent context across sessions. Conversation
          decisions, findings, patterns, and errors are saved and searchable.
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
            onChange={(e) =>
              handlePruneDaysChange(parseInt(e.target.value, 10))
            }
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

      {/* Speech-to-Text Card */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Mic className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Speech-to-Text</span>
        </div>

        <p className="text-xs text-muted-foreground">
          Language for voice transcription using local Whisper AI. Auto-detect
          works well but specifying a language improves accuracy.
        </p>

        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-muted-foreground shrink-0">
            Language
          </label>
          <Select value={sttLanguage} onValueChange={handleSttLanguageChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Auto-detect" />
            </SelectTrigger>
            <SelectContent>
              {WHISPER_LANGUAGES.map((lang) => (
                <SelectItem
                  key={lang.value}
                  value={lang.value}
                  className="text-xs"
                >
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* File Indexing Card */}
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">File Indexing</span>
          </div>
          <Button
            variant={settings.file_indexing_enabled ? "secondary" : "ghost"}
            size="icon"
            onClick={() => handleToggle("file_indexing_enabled")}
            title={settings.file_indexing_enabled ? "Disable" : "Enable"}
            className="h-8 w-8"
          >
            {settings.file_indexing_enabled ? (
              <ToggleRight className="h-3.5 w-3.5" />
            ) : (
              <ToggleLeft className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Index source files using AWS Bedrock embeddings. Relevant code
          snippets are injected into chat context automatically.
        </p>

        {/* AWS Profile */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            AWS Profile
          </label>
          <div className="flex items-center gap-2">
            <Select
              value={settings.file_indexing_aws_profile}
              onValueChange={(val) => {
                const next = { ...settings, file_indexing_aws_profile: val };
                setSettings(next);
                saveSettings(next);
              }}
              disabled={!settings.file_indexing_enabled}
            >
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue placeholder="Select profile" />
              </SelectTrigger>
              <SelectContent>
                {awsProfiles.map((p) => (
                  <SelectItem key={p} value={p} className="text-xs">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleFetchAwsProfiles}
              disabled={!settings.file_indexing_enabled}
              className="h-8 text-xs shrink-0"
            >
              Refresh
            </Button>
          </div>
          {awsProfiles.length === 0 && settings.file_indexing_enabled && (
            <p className="text-xs text-destructive">
              No AWS profiles found. Configure ~/.aws/credentials first.
            </p>
          )}
        </div>

        {/* AWS Region */}
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs font-medium text-muted-foreground shrink-0">
            AWS Region
          </label>
          <Select
            value={settings.file_indexing_aws_region}
            onValueChange={(val) => {
              const next = { ...settings, file_indexing_aws_region: val };
              setSettings(next);
              saveSettings(next);
            }}
            disabled={!settings.file_indexing_enabled}
          >
            <SelectTrigger className="h-8 text-xs w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="us-east-1" className="text-xs">
                us-east-1
              </SelectItem>
              <SelectItem value="us-east-2" className="text-xs">
                us-east-2
              </SelectItem>
              <SelectItem value="us-west-2" className="text-xs">
                us-west-2
              </SelectItem>
              <SelectItem value="eu-west-1" className="text-xs">
                eu-west-1
              </SelectItem>
              <SelectItem value="eu-central-1" className="text-xs">
                eu-central-1
              </SelectItem>
              <SelectItem value="ap-southeast-1" className="text-xs">
                ap-southeast-1
              </SelectItem>
              <SelectItem value="ap-northeast-1" className="text-xs">
                ap-northeast-1
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Embedding Model */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            Embedding Model
          </label>
          <Select
            value={settings.file_indexing_embedding_model}
            onValueChange={(val) => {
              const next = { ...settings, file_indexing_embedding_model: val };
              setSettings(next);
              saveSettings(next);
            }}
            disabled={!settings.file_indexing_enabled}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                value="amazon.titan-embed-text-v2:0"
                className="text-xs"
              >
                Titan Text V2 (1024-dim, Recommended)
              </SelectItem>
              <SelectItem
                value="amazon.titan-embed-text-v1"
                className="text-xs"
              >
                Titan Text V1 (1536-dim)
              </SelectItem>
              <SelectItem value="cohere.embed-english-v3" className="text-xs">
                Cohere English V3 (1024-dim)
              </SelectItem>
              <SelectItem
                value="cohere.embed-multilingual-v3"
                className="text-xs"
              >
                Cohere Multilingual V3 (1024-dim)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Test Connection */}
        <div className="space-y-2">
          <Button
            size="sm"
            variant="outline"
            disabled={testingAws || !settings.file_indexing_enabled}
            onClick={handleTestAwsConnection}
            className="w-full"
          >
            {testingAws ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Testing
                connection…
              </>
            ) : (
              "Test AWS Connection"
            )}
          </Button>
          {awsTestResult && (
            <p
              className={`text-xs ${awsTestResult.ok ? "text-green-600" : "text-destructive"}`}
            >
              {awsTestResult.ok
                ? `✓ Connected — ${awsTestResult.model} (${awsTestResult.dimensions}-dim)`
                : `✗ Connection failed${awsTestResult.error ? `: ${awsTestResult.error}` : ""}`}
            </p>
          )}
        </div>

        {/* Max file size slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">
              Max file size
            </label>
            <span className="text-xs font-mono tabular-nums">
              {settings.file_indexing_max_file_size >= 1048576
                ? `${(settings.file_indexing_max_file_size / 1048576).toFixed(1)} MB`
                : `${(settings.file_indexing_max_file_size / 1024).toFixed(0)} KB`}
            </span>
          </div>
          <input
            type="range"
            min={102400}
            max={10485760}
            step={102400}
            value={settings.file_indexing_max_file_size}
            onChange={(e) => {
              const next = {
                ...settings,
                file_indexing_max_file_size: parseInt(e.target.value, 10),
              };
              setSettings(next);
              saveSettings(next);
            }}
            disabled={!settings.file_indexing_enabled}
            className="w-full h-1.5 rounded-full appearance-none bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>100 KB</span>
            <span>5 MB</span>
            <span>10 MB</span>
          </div>
        </div>

        {/* Chunk size */}
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs font-medium text-muted-foreground shrink-0">
            Chunk size
          </label>
          <input
            type="number"
            min={200}
            max={8000}
            step={100}
            value={settings.file_indexing_chunk_size}
            onChange={(e) => {
              const val = Math.max(
                200,
                Math.min(8000, parseInt(e.target.value, 10) || 2000),
              );
              const next = { ...settings, file_indexing_chunk_size: val };
              setSettings(next);
              saveSettings(next);
            }}
            disabled={!settings.file_indexing_enabled}
            className="h-8 w-24 text-xs font-mono bg-muted rounded-md px-2 border text-right focus:ring-1 focus:ring-ring outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {/* Top-K for context */}
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs font-medium text-muted-foreground shrink-0">
            Top-K for context
          </label>
          <input
            type="number"
            min={1}
            max={20}
            step={1}
            value={settings.file_indexing_top_k}
            onChange={(e) => {
              const val = Math.max(
                1,
                Math.min(20, parseInt(e.target.value, 10) || 5),
              );
              const next = { ...settings, file_indexing_top_k: val };
              setSettings(next);
              saveSettings(next);
            }}
            disabled={!settings.file_indexing_enabled}
            className="h-8 w-24 text-xs font-mono bg-muted rounded-md px-2 border text-right focus:ring-1 focus:ring-ring outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />
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
          <span className="text-[10px] text-muted-foreground font-mono">
            AGENTS.md
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          Global rules injected into every agent conversation. Edit the shared
          instructions that all agents receive.
        </p>

        <textarea
          value={agentsMdContent}
          onChange={(e) => {
            setAgentsMdContent(e.target.value);
            setAgentsMdDirty(true);
          }}
          className="w-full min-h-[200px] max-h-[400px] text-xs font-mono bg-muted rounded-md p-3 border resize-y focus:ring-1 focus:ring-ring outline-none"
          spellCheck={false}
          placeholder="# Global agent rules..."
        />

        <div className="flex items-center justify-between">
          {agentsMdDirty && (
            <span className="text-xs text-muted-foreground">
              Unsaved changes
            </span>
          )}
          <div className="ml-auto">
            <Button
              size="sm"
              disabled={!agentsMdDirty || agentsMdSaving}
              onClick={handleSaveAgentsMd}
            >
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
    </div>
  );
}
