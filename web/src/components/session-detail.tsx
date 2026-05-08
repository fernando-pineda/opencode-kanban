import {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useCallback,
  type ComponentPropsWithoutRef,
  memo,
  useMemo,
} from "react";
import ReactDOM from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  X,
  ChevronDown,
  ChevronRight,
  Loader2,
  Bot,
  GripVertical,
  Terminal,
  Pencil,
  FileText,
  Search,
  Circle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ListTodo,
  Shrink,
  ArrowRight,
  Square,
  HelpCircle,
  Trash2,
  AlertCircle,
  Activity,
  Sparkles,
  MessageCircle,
  Mic,
  MicOff,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Popover as PopoverPrimitive } from "radix-ui";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverContent = PopoverPrimitive.Content;
const PopoverClose = PopoverPrimitive.Close;

/* ── Types ─────────────────────────────────────────────── */

interface Message {
  id: string;
  role: "user" | "assistant";
  model: string | null;
  agent: string | null;
  time_created: number;
  text: string;
  reasoning: string;
  tool_calls: ToolCall[];
  compactions?: Array<{ auto: boolean; tail_start_id: string }>;
}

interface ToolCall {
  tool: string;
  callID: string;
  status: "completed" | "running" | "failed";
  input: Record<string, unknown>;
  output: string;
}

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
}

interface SessionData {
  session_id: string;
  title: string | null;
  directory: string | null;
  model: string | { providerID: string; modelID: string } | null;
  total: number;
  context_tokens: number;
  messages: Message[];
}

interface ChildSession {
  id: string;
  slug: string;
  title: string;
  directory: string;
  time: { created: number; updated: number };
  summary: { additions: number; deletions: number; files: number };
}

interface SessionStatusMap {
  [sessionId: string]: { type: "busy" | "idle" | "retry" };
}

interface SessionDetailProps {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newSessionDirectory?: string | null;
  onSessionCreated?: (sessionId: string) => void;
  boardId?: number | null;
}

/* ── Helpers ───────────────────────────────────────────── */

const LAST_N = 20;

function formatDuration(startMs: number, endMs?: number): string {
  const end = endMs || Date.now();
  const seconds = Math.floor((end - startMs) / 1000);
  if (seconds < 2) return "<2s";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m${secs > 0 ? ` ${secs}s` : ""}`;
}

function truncateText(
  text: string | undefined | null,
  maxLength: number = 50,
): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.substring(0, maxLength)}…`;
}

/** Strip <mandatory>…</mandatory> blocks from displayed text (rules injected server-side) */
function stripMandatoryTags(text: string | undefined | null): string {
  if (!text) return "";
  return text.replace(/<mandatory>[\s\S]*?<\/mandatory>\s*/g, "").trim();
}

/** Strip <swarm-plan>…</swarm-plan> blocks from displayed text */
function stripSwarmPlanTags(text: string): string {
  return text.replace(/<swarm-plan>[\s\S]*?<\/swarm-plan>/g, "").trim();
}

function extractTaskId(output: string): string | null {
  if (!output) return null;
  const match = output.match(/task_id:\s*(ses_[a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

function formatTimeAgo(timestampMs: number): string {
  const seconds = Math.floor((Date.now() - timestampMs) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatTokenCount(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

function toCamelCase(str: string): string {
  if (!str) return "";
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

function getModelDisplayName(modelStr: string): string {
  if (!modelStr) return "";
  const stripped = modelStr.replace(/^[a-z]+\./, "");
  return stripped.replace(/-202\d{5}$/, "");
}

/* ── Agent persistence helpers ──────────────────────────── */

const LAST_AGENT_KEY = "kanban_last_agent";

function saveAgentForSession(sessionId: string, agentName: string): void {
  try {
    localStorage.setItem(`kanban_agent_${sessionId}`, agentName);
    localStorage.setItem(LAST_AGENT_KEY, agentName);
  } catch {}
}

function getAgentForSession(sessionId: string | null): string | null {
  try {
    if (sessionId) {
      const perSession = localStorage.getItem(`kanban_agent_${sessionId}`);
      if (perSession) return perSession;
    }
    return localStorage.getItem(LAST_AGENT_KEY);
  } catch {
    return null;
  }
}

/* ── Markdown prose components ──────────────────────────── */

const ProsePre = ({ children, ...props }: ComponentPropsWithoutRef<"pre">) => {
  // Check if this is a JSON code block containing a status message
  let codeContent: string | null = null;
  let isJsonBlock = false;

  // ReactMarkdown renders code blocks as: <pre><code className="language-json">...</code></pre>
  if (
    children &&
    typeof children === "object" &&
    "props" in (children as any)
  ) {
    const child = children as any;
    isJsonBlock = child.props?.className?.includes("language-json") || false;
    codeContent =
      typeof child.props?.children === "string" ? child.props.children : null;
  }

  // Extract raw text for the copy button (handles both structured children and plain string children)
  const rawText = codeContent || (typeof children === "string" ? children : "");

  if (isJsonBlock && codeContent) {
    const statusData = tryParseStatusJson(codeContent);
    if (statusData) {
      return (
        <div className="relative group my-2">
          <StatusCard data={statusData} />
          <div className="absolute top-1 right-1">
            <CopyButton text={codeContent} />
          </div>
        </div>
      );
    }
  }

  return (
    <div className="relative group my-2">
      <pre
        {...props}
        className="bg-muted text-muted-foreground rounded-md p-3 text-xs overflow-x-auto leading-relaxed"
      >
        {children}
      </pre>
      {rawText && (
        <div className="absolute top-1 right-1">
          <CopyButton text={rawText} />
        </div>
      )}
    </div>
  );
};

const ProseCode = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"code">) => {
  if (className) {
    return (
      <code className={cn(className, "text-xs")} {...props}>
        {children}
      </code>
    );
  }
  return (
    <code
      className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs font-mono"
      {...props}
    >
      {children}
    </code>
  );
};

function MarkdownContent({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ProsePre,
          code: ProseCode,
          p: ({ children }) => (
            <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="my-1.5 list-disc pl-5 space-y-0.5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1.5 list-decimal pl-5 space-y-0.5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-snug">{children}</li>,
          h1: ({ children }) => (
            <h1 className="text-base font-semibold mt-3 mb-1">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-semibold mt-2 mb-1">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-medium mt-2 mb-0.5">{children}</h3>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-muted-foreground/30 pl-3 my-1.5 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="text-xs border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-muted px-2 py-1 bg-muted font-medium text-left">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-muted px-2 py-1">{children}</td>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              className="underline underline-offset-2 text-primary"
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-3 border-muted" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/* ── Status JSON parsing ────────────────────────────────── */

interface StatusMessage {
  status: "SUCCESS" | "FAILURE" | "PARTIAL";
  files_modified?: string[];
  summary?: string;
  validation_result?:
    | "VALIDATION_PASSED"
    | "VALIDATION_FAILED"
    | "NOT_RUN"
    | string;
  errors?: string | null | Array<{ message: string }> | Record<string, string>;
  [key: string]: unknown;
}

function tryParseStatusJson(text: string): StatusMessage | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed === "object" &&
      "status" in parsed &&
      ("files_modified" in parsed || "summary" in parsed)
    ) {
      return parsed as StatusMessage;
    }
    return null;
  } catch {
    return null;
  }
}

const StatusCard = memo(function StatusCard({ data }: { data: StatusMessage }) {
  const statusConfig = {
    SUCCESS: {
      bg: "bg-green-500/10",
      border: "border-green-500/30",
      icon: <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />,
      badge: "bg-green-500/20 text-green-600 dark:text-green-400",
      label: "Success",
    },
    FAILURE: {
      bg: "bg-red-500/10",
      border: "border-red-500/30",
      icon: <X className="w-4 h-4 text-red-500 shrink-0" />,
      badge: "bg-red-500/20 text-red-600 dark:text-red-400",
      label: "Failed",
    },
    PARTIAL: {
      bg: "bg-amber-500/10",
      border: "border-amber-500/30",
      icon: <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />,
      badge: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
      label: "Partial",
    },
  };

  const config = statusConfig[data.status] || statusConfig.PARTIAL;
  const hasValidation =
    !!data.validation_result && data.validation_result !== "NOT_RUN";

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden my-2",
        config.border,
        config.bg,
      )}
    >
      {/* Status header */}
      <div className={cn("flex items-center gap-2 px-3 py-2", config.bg)}>
        {config.icon}
        <span className="text-xs font-semibold">{config.label}</span>
        {hasValidation && (
          <span
            className={cn(
              "ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium",
              config.badge,
            )}
          >
            {data.validation_result === "VALIDATION_PASSED"
              ? "✓ Validation Passed"
              : data.validation_result}
          </span>
        )}
      </div>

      {/* Summary */}
      {data.summary && (
        <div className="px-3 py-2 border-t border-muted/50">
          <p className="text-xs text-foreground leading-relaxed">
            {data.summary}
          </p>
        </div>
      )}

      {/* Files modified */}
      {data.files_modified && data.files_modified.length > 0 && (
        <div className="px-3 py-2 border-t border-muted/50">
          <div className="flex items-center gap-1.5 mb-1.5">
            <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Files ({data.files_modified.length})
            </span>
          </div>
          <div className="space-y-0.5">
            {data.files_modified.map((file, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground shrink-0">•</span>
                <code className="font-mono text-muted-foreground truncate">
                  {file}
                </code>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Errors */}
      {data.errors && (
        <div className="px-3 py-2 border-t border-red-500/20 bg-red-500/5">
          <span className="text-[10px] font-medium text-red-500 uppercase tracking-wide">
            Errors
          </span>
          <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
            {typeof data.errors === "string"
              ? data.errors
              : JSON.stringify(data.errors, null, 2)}
          </p>
        </div>
      )}
    </div>
  );
});

/* ── Tool call summary extraction ──────────────────────── */

function extractToolSummary(toolCall: ToolCall): {
  icon: React.ReactNode;
  label: string;
  detail: string;
} {
  const input = (toolCall.input || {}) as Record<string, any>;
  switch (toolCall.tool) {
    case "bash":
    case "exec": {
      const cmd =
        typeof input.command === "string"
          ? input.command
          : input.command?.command || "";
      return {
        icon: <Terminal className="w-3 h-3 shrink-0" />,
        label: "bash",
        detail: cmd,
      };
    }
    case "edit":
    case "write":
    case "create":
    case "filesystem_edit_file":
    case "filesystem_write_file": {
      const file = input.filePath || input.path || input.file_path || "";
      return {
        icon: <Pencil className="w-3 h-3 shrink-0" />,
        label: toolCall.tool,
        detail: file,
      };
    }
    case "read":
    case "filesystem_read_file":
    case "filesystem_read_text_file": {
      const file = input.filePath || input.path || input.file_path || "";
      return {
        icon: <FileText className="w-3 h-3 shrink-0" />,
        label: "read",
        detail: file,
      };
    }
    case "grep":
    case "search":
    case "glob": {
      const q = input.pattern || input.query || input.search || "";
      return {
        icon: <Search className="w-3 h-3 shrink-0" />,
        label: toolCall.tool,
        detail: q,
      };
    }
    default:
      return { icon: null, label: toolCall.tool, detail: "" };
  }
}

/* ── Inline tool call display ──────────────────────────── */

const ToolCallInline = memo(function ToolCallInline({
  toolCall,
}: {
  toolCall: ToolCall;
}) {
  const [open, setOpen] = useState(false);
  const { icon, label, detail } = extractToolSummary(toolCall);
  const output =
    typeof toolCall.output === "string" ? toolCall.output.trim() : "";

  if (!detail && !output) return null;

  const isFailed = toolCall.status === "failed";
  const isRunning = toolCall.status === "running";

  // Detect language from detail (file path)
  const langFromPath = (detail.match(/\.(\w+)$/) || [])[1]?.toLowerCase();
  const codeLang =
    langFromPath === "tsx"
      ? "tsx"
      : langFromPath === "ts"
        ? "typescript"
        : langFromPath === "js"
          ? "javascript"
          : langFromPath === "jsx"
            ? "jsx"
            : langFromPath === "py"
              ? "python"
              : langFromPath === "sh" || langFromPath === "bash"
                ? "bash"
                : langFromPath === "yml"
                  ? "yaml"
                  : langFromPath || "text";

  const isCode =
    output.length > 20 &&
    (output.includes("\n") ||
      output.includes("{") ||
      output.includes("(") ||
      detail.match(
        /\.(ts|tsx|js|jsx|py|rs|go|json|yaml|yml|sh|bash|sql|html|css|md)$/i,
      ));

  return (
    <div
      className={cn(
        "rounded-md border overflow-hidden",
        isFailed
          ? "border-destructive/30 bg-destructive/5"
          : "border-muted bg-muted/30",
      )}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 cursor-pointer text-xs">
            {icon}
            <span className="font-mono font-medium text-muted-foreground">
              {label}
            </span>
            {detail && (
              <span className="font-mono text-muted-foreground truncate flex-1 text-left">
                {detail}
              </span>
            )}
            {isRunning && (
              <Loader2 className="w-3 h-3 animate-spin shrink-0 text-blue-500" />
            )}
            {isFailed && (
              <span className="text-destructive text-[10px] shrink-0">
                failed
              </span>
            )}
            <ChevronDown
              className={cn(
                "w-3 h-3 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {output &&
            (isCode ? (
              <SyntaxHighlighter
                language={codeLang}
                style={oneDark}
                customStyle={{
                  margin: 0,
                  padding: "8px 12px",
                  fontSize: "11px",
                  borderRadius: 0,
                  background: "rgb(24 24 27)",
                }}
                showLineNumbers={output.split("\n").length > 3}
              >
                {output}
              </SyntaxHighlighter>
            ) : (
              <pre className="text-xs px-3 py-2 whitespace-pre-wrap break-words border-t bg-background/50 max-h-60 overflow-y-auto">
                {output}
              </pre>
            ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});

/* ── Question tool card ────────────────────────────────────── */

const QuestionToolCard = memo(function QuestionToolCard({
  toolCall,
  sessionId,
  directory,
  onAnswerSubmitted,
}: {
  toolCall: ToolCall;
  sessionId: string;
  directory: string | null;
  onAnswerSubmitted: () => void;
}) {
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>(
    {},
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [questionFetched, setQuestionFetched] = useState(false);

  const input = (toolCall.input || {}) as Record<string, any>;
  const questions = Array.isArray(input.questions)
    ? (input.questions as Array<{
        question: string;
        header: string;
        options: Array<{ label: string; description: string }>;
        multiple?: boolean;
      }>)
    : [];

  const isRunning = toolCall.status === "running";

  // Fetch the opencode question ID (que_...) that corresponds to this tool call
  useEffect(() => {
    if (questionFetched || !isRunning || submitted) return;
    setQuestionFetched(true);
    fetch(
      `/api/opencode/question${directory ? `?directory=${encodeURIComponent(directory)}` : ""}`,
      { cache: "no-store" },
    )
      .then((res) => (res.ok ? res.json() : []))
      .then(
        (
          qs: Array<{
            id: string;
            sessionID: string;
            tool?: { callID?: string };
          }>,
        ) => {
          const match = qs.find(
            (q) =>
              q.sessionID === sessionId && q.tool?.callID === toolCall.callID,
          );
          if (match) setQuestionId(match.id);
        },
      )
      .catch(() => {});
  }, [
    isRunning,
    submitted,
    questionFetched,
    sessionId,
    toolCall.callID,
    directory,
  ]);

  // If completed, show what was answered
  if (!isRunning || submitted) {
    const outputText =
      typeof toolCall.output === "string" ? toolCall.output : "";
    return (
      <div className="rounded-md border border-blue-500/30 bg-blue-500/5 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10">
          <HelpCircle className="w-3 h-3 text-blue-500 shrink-0" />
          <span className="font-mono font-medium text-xs text-blue-500">
            question
          </span>
          {submitted && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              answered
            </span>
          )}
        </div>
        {outputText && (
          <pre className="text-xs px-3 py-2 whitespace-pre-wrap break-words border-t bg-background/50 max-h-40 overflow-y-auto">
            {outputText}
          </pre>
        )}
      </div>
    );
  }

  const toggleOption = (qIndex: number, label: string, multiple?: boolean) => {
    setAnswers((prev) => {
      const current = prev[qIndex] || [];
      if (multiple) {
        return {
          ...prev,
          [qIndex]: current.includes(label)
            ? current.filter((l) => l !== label)
            : [...current, label],
        };
      } else {
        // Single-select: clear custom text when picking an option
        setCustomAnswers((cp) => {
          if (cp[qIndex]) {
            const next = { ...cp };
            delete next[qIndex];
            return next;
          }
          return cp;
        });
        return {
          ...prev,
          [qIndex]: current.includes(label) ? [] : [label],
        };
      }
    });
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // Build answers array matching questions order
      const answerArray: string[][] = [];
      for (let i = 0; i < questions.length; i++) {
        const selected = answers[i] || [];
        const custom = customAnswers[i]?.trim();
        if (selected.length > 0) {
          answerArray.push(selected);
        } else if (custom) {
          answerArray.push([custom]);
        } else {
          answerArray.push([]);
        }
      }
      if (answerArray.every((a) => a.length === 0)) return;

      let qid = questionId;
      if (!qid) {
        // Fallback: fetch question list to find the que_ ID
        const listRes = await fetch(
          `/api/opencode/question${directory ? `?directory=${encodeURIComponent(directory)}` : ""}`,
          { cache: "no-store" },
        );
        if (listRes.ok) {
          const list: Array<{
            id: string;
            sessionID: string;
            tool?: { callID?: string };
          }> = await listRes.json();
          const match = list.find(
            (q) =>
              q.sessionID === sessionId && q.tool?.callID === toolCall.callID,
          );
          if (match) {
            qid = match.id;
            setQuestionId(match.id);
          }
        }
      }

      if (qid) {
        const res = await fetch(
          `/api/opencode/question/${qid}/reply${directory ? `?directory=${encodeURIComponent(directory)}` : ""}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answers: answerArray }),
          },
        );
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
      } else {
        throw new Error("Could not find pending question");
      }
      setSubmitted(true);
      onAnswerSubmitted();
    } catch (err) {
      console.error("Failed to submit answer:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const allAnswered = questions.every(
    (_, i) => (answers[i]?.length || 0) > 0 || customAnswers[i]?.trim(),
  );

  return (
    <div className="rounded-md border border-blue-500/30 bg-blue-500/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10">
        <HelpCircle className="w-3 h-3 text-blue-500 shrink-0" />
        <span className="font-mono font-medium text-xs text-blue-500">
          Questions for you
        </span>
      </div>
      <div className="px-3 py-2 space-y-3">
        {questions.map((q, qIndex) => (
          <div key={qIndex} className="space-y-1.5">
            <div className="text-xs font-medium">{q.header}</div>
            <div className="text-xs text-muted-foreground">{q.question}</div>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((opt) => {
                const isSelected = (answers[qIndex] || []).includes(opt.label);
                return (
                  <button
                    key={opt.label}
                    onClick={() => toggleOption(qIndex, opt.label, q.multiple)}
                    className={cn(
                      "text-xs px-2.5 py-1.5 rounded-md border transition-colors text-left",
                      isSelected
                        ? "border-blue-500 bg-blue-500/20 text-foreground"
                        : "border-muted bg-background hover:bg-muted/50",
                    )}
                  >
                    <span className="font-medium">{opt.label}</span>
                    {opt.description && (
                      <span className="text-muted-foreground ml-1">
                        — {opt.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              placeholder="Type your own answer…"
              value={customAnswers[qIndex] || ""}
              onChange={(e) => {
                const val = e.target.value;
                setCustomAnswers((prev) => ({
                  ...prev,
                  [qIndex]: val,
                }));
                // Single-select: clear options when typing custom answer
                if (val.trim() && !q.multiple) {
                  setAnswers((prev) => {
                    if ((prev[qIndex] || []).length > 0) {
                      return { ...prev, [qIndex]: [] };
                    }
                    return prev;
                  });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && allAnswered) handleSubmit();
              }}
              className="w-full text-xs px-2.5 py-1.5 rounded-md border border-muted bg-background placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        ))}
        <button
          onClick={handleSubmit}
          disabled={!allAnswered || submitting}
          className={cn(
            "text-xs px-3 py-1.5 rounded-md font-medium transition-colors",
            allAnswered && !submitting
              ? "bg-blue-500 text-white hover:bg-blue-600"
              : "bg-muted text-muted-foreground cursor-not-allowed",
          )}
        >
          {submitting ? "Submitting…" : "Submit Answers"}
        </button>
      </div>
    </div>
  );
});

const CopyButton = memo(function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground"
      title="Copy message"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-500" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
});

const MessageRow = memo(function MessageRow({
  msg,
  prevMsg,
  nextMsg,
  isLast,
  sessionStatuses,
  children,
  onViewChild,
  sessionId,
  directory,
  onAnswerSubmitted,
  isBusy,
  isLastAssistant,
}: {
  msg: Message;
  prevMsg?: Message;
  nextMsg?: Message;
  isLast: boolean;
  sessionStatuses: Record<string, { type: string }>;
  children: ChildSession[];
  onViewChild: (childId: string) => void;
  sessionId: string;
  directory: string | null;
  onAnswerSubmitted: () => void;
  isBusy?: boolean;
  isLastAssistant?: boolean;
}) {
  const isTurnEnd =
    msg.role === "assistant" && (isLast || nextMsg?.role === "user");
  const duration =
    isTurnEnd && prevMsg?.role === "user"
      ? formatDuration(prevMsg.time_created * 1000, msg.time_created * 1000)
      : null;

  return (
    <div className="px-4 py-2">
      {/* Role header */}
      <div className="flex items-baseline justify-between gap-2 mb-1">
        {msg.role === "user" ? (
          <span className="text-xs font-medium text-muted-foreground">You</span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Bot className="w-3 h-3" />
            Assistant
            {msg.agent && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {msg.agent}
              </Badge>
            )}
          </span>
        )}
        {duration && (
          <span className="text-xs text-muted-foreground">{duration}</span>
        )}
      </div>

      {/* Thinking */}
      {(msg.reasoning || (isBusy && isLastAssistant)) && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors py-0.5">
              <ChevronDown className="w-3 h-3" />
              <span>Show thinking</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="text-xs text-muted-foreground/60 italic pl-4 py-1 border-l-2 border-muted whitespace-pre-wrap">
              {msg.reasoning || ""}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Text content */}
      {msg.text &&
        (() => {
          // Check if entire message is a raw JSON status (no markdown wrapper)
          const entireStatus =
            msg.role === "assistant" ? tryParseStatusJson(msg.text) : null;

          return (
            <div
              className={cn(
                "rounded-lg px-3 py-2",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground ml-auto max-w-[85%]"
                  : "relative group text-foreground",
              )}
            >
              <div className="text-sm">
                {entireStatus ? (
                  <StatusCard data={entireStatus} />
                ) : (
                  <MarkdownContent
                    content={stripSwarmPlanTags(stripMandatoryTags(msg.text))}
                    className={cn(
                      msg.role === "user" &&
                        "[&_a]:text-primary-foreground/80 [&_a]:underline",
                    )}
                  />
                )}
              </div>
              {msg.role === "assistant" && (
                <div className="absolute top-1 right-1">
                  <CopyButton text={msg.text} />
                </div>
              )}
            </div>
          );
        })()}

      {/* Tool calls */}
      {msg.tool_calls && msg.tool_calls.length > 0 && (
        <div className="mt-1 space-y-1">
          {msg.tool_calls.map((toolCall) => {
            if (toolCall.tool === "question") {
              return (
                <QuestionToolCard
                  key={toolCall.callID}
                  toolCall={toolCall}
                  sessionId={sessionId}
                  directory={directory}
                  onAnswerSubmitted={onAnswerSubmitted}
                />
              );
            }

            if (toolCall.tool === "task") {
              // Try to get taskId from output first
              let taskId = extractTaskId(toolCall.output);

              // If no taskId from output, try to match child from children array by description
              if (!taskId) {
                const description = (toolCall.input as Record<string, string>)
                  ?.description;
                if (description) {
                  const matchingChild = children.find(
                    (c) =>
                      c.title === description || c.title?.includes(description),
                  );
                  if (matchingChild) {
                    taskId = matchingChild.id;
                  }
                }
              }

              const childStatus = taskId ? sessionStatuses[taskId] : undefined;
              // Consider tool call status AND session status for busy state
              const isBusy =
                toolCall.status === "running" ||
                childStatus?.type === "busy" ||
                childStatus?.type === "retry";
              const title =
                (toolCall.input as Record<string, string>)?.description ||
                "Subagent task";

              return (
                <button
                  key={toolCall.callID}
                  onClick={() => {
                    if (taskId) onViewChild(taskId);
                  }}
                  className="flex items-center gap-2 text-xs px-3 py-2 rounded-md border border-dashed border-muted-foreground/20 bg-muted/30 hover:bg-muted/50 transition-colors w-full text-left group"
                >
                  {isBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500/60 shrink-0" />
                  )}
                  <Bot className="w-3 h-3 shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1 font-medium">{title}</span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              );
            }

            return <ToolCallInline key={toolCall.callID} toolCall={toolCall} />;
          })}
        </div>
      )}

      {/* Compaction indicators */}
      {msg.compactions && msg.compactions.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {msg.compactions.map((comp, ci) => (
            <div
              key={ci}
              className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-1 rounded-md bg-muted/40 border border-dashed border-muted-foreground/20"
            >
              <Shrink className="w-3 h-3 shrink-0" />
              <span>{comp.auto ? "Auto-compacted" : "Session compacted"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

/* ── Todo panel ────────────────────────────────────────── */

const TodoPanel = memo(function TodoPanel({ todos }: { todos: TodoItem[] }) {
  const [open, setOpen] = useState(false);
  const done = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;

  if (total === 0) return null;

  const statusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />;
      case "in_progress":
        return (
          <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
        );
      default:
        return (
          <Circle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
        );
    }
  };

  const priorityColor = (p: string) => {
    switch (p) {
      case "high":
        return "text-red-500";
      case "medium":
        return "text-yellow-500";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <div className="border-t bg-muted/20 px-4 py-2">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-2 text-xs font-medium w-full hover:text-foreground transition-colors">
            <ListTodo className="w-3.5 h-3.5" />
            <span>Todos</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
              {done}/{total}
            </Badge>
            {done === total && total > 0 && (
              <CheckCircle2 className="w-3 h-3 text-green-500" />
            )}
            <ChevronDown
              className={cn(
                "w-3 h-3 ml-auto text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-1">
            {todos.map((todo, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-2 text-xs py-0.5",
                  todo.status === "completed" &&
                    "text-muted-foreground line-through",
                )}
              >
                {statusIcon(todo.status)}
                <span
                  className={cn(
                    "mt-px leading-snug",
                    todo.status === "in_progress" && "font-medium",
                  )}
                >
                  {todo.content}
                </span>
                <span
                  className={cn(
                    "text-[10px] mt-px shrink-0",
                    priorityColor(todo.priority),
                  )}
                >
                  {todo.priority === "high"
                    ? "●"
                    : todo.priority === "medium"
                      ? "◑"
                      : "○"}
                </span>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});

/* ── File Mention Dropdown ─────────────────────────────── */

interface FileEntry {
  name: string;
  relativePath: string;
}

const FileMentionDropdown = memo(function FileMentionDropdown({
  directory,
  query,
  selectedIndex,
  onSelect,
  onClose,
  onFilesUpdate,
}: {
  directory: string;
  query: string;
  selectedIndex: number;
  onSelect: (file: FileEntry) => void;
  onClose: () => void;
  onFilesUpdate: (files: FileEntry[]) => void;
}) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Fetch files when directory or query changes
  useEffect(() => {
    if (!directory) return;
    setLoading(true);
    const controller = new AbortController();
    const params = new URLSearchParams({ directory });
    if (query) params.set("query", query);
    fetch(`/api/filesystem/search-files?${params}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: { files: FileEntry[] }) => {
        const fileList = data.files || [];
        setFiles(fileList);
        onFilesUpdate(fileList);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [directory, query, onFilesUpdate]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.children[selectedIndex] as
      | HTMLElement
      | undefined;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Close on Escape is handled by parent
  if (!directory) return null;
  // Don't render if no directory

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 max-h-52 overflow-hidden rounded-md border border-muted bg-popover shadow-lg z-50">
      <div ref={listRef} className="overflow-y-auto max-h-52">
        {loading ? (
          <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Searching files…</span>
          </div>
        ) : files.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            No files found
          </div>
        ) : (
          files.map((file, i) => (
            <button
              key={file.relativePath}
              className={cn(
                "w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors flex items-center gap-2",
                i === selectedIndex && "bg-muted/50",
              )}
              onClick={() => onSelect(file)}
              onMouseDown={(e) => e.preventDefault()}
            >
              <FileText className="w-3 h-3 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono">{file.relativePath}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
});

/* ── ChatInput Component ───────────────────────────────── */

interface ChatInputProps {
  sending: boolean;
  isBusy: boolean;
  agents: {
    name: string;
    description?: string;
    mode?: string;
    model?: { providerID: string; modelID: string };
  }[];
  selectedAgent: string;
  onAgentChange: (agent: string) => void;
  onSend: (text: string) => Promise<void>;
  onStop: () => void;
  contextTokens: number;
  contextLimit: number;
  modelName: string;
  sessionId: string | null;
  onClose: () => void;
  data: SessionData | null;
  directory: string | null;
}

const LINE_HEIGHT = 20;
const MAX_TEXTAREA_HEIGHT = LINE_HEIGHT * 4 + 16;

function getDraftKey(
  sessionId: string | null,
  directory: string | null,
): string {
  if (sessionId) return `kanban_draft_${sessionId}`;
  if (directory) return `kanban_draft_new_${directory}`;
  return `kanban_draft_new`;
}

const ChatInput = memo(function ChatInput({
  sending,
  isBusy,
  agents,
  selectedAgent,
  onAgentChange,
  onSend,
  onStop,
  contextTokens,
  contextLimit,
  modelName,
  sessionId,
  onClose,
  data,
  directory,
}: ChatInputProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionStartRef = useRef<number | null>(null);
  const mentionFilesRef = useRef<FileEntry[]>([]);

  // Speech recognition
  const {
    isListening,
    interimTranscript,
    supported: speechSupported,
    error: speechError,
    startListening,
    stopListening,
  } = useSpeechRecognition({
    lang: undefined, // use browser default
    onFinalTranscript: (text) => {
      // Append to existing input
      setInputValue((prev) => {
        const separator =
          prev && !prev.endsWith(" ") && !prev.endsWith("\n") ? " " : "";
        return prev + separator + text;
      });
    },
  });

  const draftKey = useMemo(
    () => getDraftKey(sessionId || null, directory || null),
    [sessionId, directory],
  );

  const handleMentionFilesUpdate = useCallback((files: FileEntry[]) => {
    mentionFilesRef.current = files;
    // Clamp selection index to files length
    setMentionIndex((prev) => Math.min(prev, Math.max(0, files.length - 1)));
  }, []);

  // Restore draft from localStorage on mount or when draftKey changes
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        setInputValue(saved);
        // Set textarea height
        requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.style.height = "auto";
            inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
          }
        });
      }
    } catch {}
  }, [draftKey]);

  // Focus input when sending transitions from true to false
  useEffect(() => {
    if (!sending && inputRef.current) {
      inputRef.current.focus();
    }
  }, [sending]);

  // Auto-update textarea height when input changes from speech
  const prevSpeechRef = useRef("");
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
    }
  }, [inputValue]);

  // Voice dictation toggle: Cmd+I / Ctrl+I
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "i") {
        e.preventDefault();
        if (!speechSupported) return;
        if (isListening) {
          stopListening();
        } else {
          startListening();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [speechSupported, isListening, startListening, stopListening]);

  // Show speech error toast
  useEffect(() => {
    if (speechError) {
      toast.error(speechError);
    }
  }, [speechError]);

  // Auto-focus textarea when speech starts
  useEffect(() => {
    if (isListening && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isListening]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text) return;

    try {
      await onSend(text);
      setInputValue("");
      if (inputRef.current) {
        inputRef.current.style.height = "auto";
      }
      try {
        localStorage.removeItem(draftKey);
      } catch {}
    } catch (err) {
      // Show error toast so the user knows what happened
      const message =
        err instanceof Error ? err.message : "Failed to send message";
      toast.error(`Failed to send: ${message}`);
      console.error("Failed to send message:", err);
    }
  }, [inputValue, onSend, draftKey]);

  const handleMentionSelect = useCallback(
    (file: { name: string; relativePath: string }) => {
      if (mentionStartRef.current === null) return;
      const before = inputValue.slice(0, mentionStartRef.current);
      const after = inputValue.slice(
        inputRef.current?.selectionStart || inputValue.length,
      );
      const newText = `${before}@${file.relativePath} ${after}`;
      setInputValue(newText);
      setMentionOpen(false);
      mentionStartRef.current = null;

      // Save draft to localStorage
      try {
        localStorage.setItem(draftKey, newText);
      } catch {}

      // Set cursor position after the inserted mention
      requestAnimationFrame(() => {
        if (inputRef.current) {
          const newPos = before.length + file.relativePath.length + 2; // +2 for @ and space
          inputRef.current.selectionStart = newPos;
          inputRef.current.selectionEnd = newPos;
          inputRef.current.focus();
          inputRef.current.style.height = "auto";
          inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
        }
      });
    },
    [inputValue, draftKey],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Mention dropdown navigation
    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((prev) => prev + 1); // Will be clamped by dropdown
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const files = mentionFilesRef.current;
        if (files.length > 0 && mentionIndex < files.length) {
          handleMentionSelect(files[mentionIndex]);
        }
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Tab" && agents.length > 1 && !mentionOpen) {
      e.preventDefault();
      const currentIdx = agents.findIndex((a) => a.name === selectedAgent);
      const nextIdx = (currentIdx + 1) % agents.length;
      onAgentChange(agents[nextIdx].name);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInputValue(value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;

    // Detect @ mention trigger
    const cursorPos = el.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);

    // Find the last @ that could be a mention trigger (preceded by start of string or whitespace)
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");
    if (lastAtIndex !== -1) {
      // Check if @ is preceded by start of string or whitespace
      const charBefore =
        lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : " ";
      if (charBefore === " " || charBefore === "\n" || lastAtIndex === 0) {
        // Check if there's no whitespace between @ and cursor
        const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
        if (!textAfterAt.includes(" ") && !textAfterAt.includes("\n")) {
          mentionStartRef.current = lastAtIndex;
          setMentionQuery(textAfterAt);
          setMentionIndex(0);
          if (!mentionOpen) setMentionOpen(true);
          // Save draft to localStorage
          try {
            if (value.trim()) {
              localStorage.setItem(draftKey, value);
            } else {
              localStorage.removeItem(draftKey);
            }
          } catch {}
          return;
        }
      }
    }
    // No valid mention trigger
    if (mentionOpen) {
      setMentionOpen(false);
      mentionStartRef.current = null;
    }

    // Save draft to localStorage
    try {
      if (value.trim()) {
        localStorage.setItem(draftKey, value);
      } else {
        localStorage.removeItem(draftKey);
      }
    } catch {}
  };

  const handleFocus = () => {
    if (inputRef.current && inputRef.current.value !== inputValue) {
      setInputValue("");
      inputRef.current.value = "";
    }
  };

  return (
    <div className="px-4 pt-3 pb-3">
      {/* Input container with all elements inside */}
      <div
        className={cn(
          "relative bg-input rounded-md",
          isListening && "ring-2 ring-red-500/50 animate-pulse",
        )}
      >
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={() => {
            setTimeout(() => setMentionOpen(false), 150);
          }}
          placeholder="Send a message…"
          rows={1}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-gramm="false"
          data-gramm_editor="false"
          className={cn(
            "w-full resize-none rounded-md border-0 bg-transparent px-3 py-2 text-sm text-white placeholder:text-muted-foreground outline-none focus:ring-0 min-h-[36px] disabled:opacity-50",
            isBusy && "pr-10",
          )}
        />

        {/* Interim speech transcript overlay */}
        {isListening && interimTranscript && (
          <div className="absolute top-2 left-3 right-3 pointer-events-none text-sm text-muted-foreground/50 italic">
            {interimTranscript}
          </div>
        )}

        {/* File mention dropdown */}
        {mentionOpen && directory && (
          <FileMentionDropdown
            directory={directory}
            query={mentionQuery}
            selectedIndex={mentionIndex}
            onSelect={handleMentionSelect}
            onClose={() => setMentionOpen(false)}
            onFilesUpdate={handleMentionFilesUpdate}
          />
        )}

        {/* Stop button — top right, inside textarea */}
        {isBusy && (
          <button
            onClick={onStop}
            className="absolute top-2 right-2 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        )}

        {/* Loading bar — bottom of textarea */}
        {isBusy && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-b-md overflow-hidden">
            <div
              className="h-full bg-primary/60"
              style={{ animation: "loading-bar 2s ease-in-out infinite" }}
            />
          </div>
        )}

        {/* Bottom bar INSIDE the input container */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-muted-foreground/10 text-xs text-muted-foreground">
          {/* Left side: agent selector + mic */}
          <div className="flex items-center gap-2">
            {agents.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span>{toCamelCase(selectedAgent)}</span>
                <kbd className="inline-flex items-center justify-center h-5 w-5 rounded border border-muted-foreground/30 bg-muted/20 text-[10px] font-mono">
                  ⇥
                </kbd>
              </div>
            )}
            {speechSupported && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      if (isListening) {
                        stopListening();
                      } else {
                        startListening();
                      }
                    }}
                    className={cn(
                      "flex items-center gap-1.5 text-xs transition-colors",
                      isListening
                        ? "text-red-500 hover:text-red-600"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {isListening ? (
                      <>
                        <MicOff className="w-3.5 h-3.5" />
                        <span className="text-[10px] animate-pulse">
                          Listening...
                        </span>
                      </>
                    ) : (
                      <>
                        <Mic className="w-3.5 h-3.5" />
                        <kbd className="inline-flex items-center justify-center h-5 px-1 rounded border border-muted-foreground/30 bg-muted/20 text-[10px] font-mono">
                          ⌘I
                        </kbd>
                      </>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6} className="text-xs">
                  {isListening ? "Stop dictation" : "Start voice dictation"}
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Right side: context tokens + model name + Done button */}
          <div className="flex items-center gap-2">
            {data &&
              (() => {
                const used = contextTokens || 0;
                const limit = contextLimit;
                const ratio = limit > 0 ? Math.min(used / limit, 1) : 0;
                const pct = Math.round(ratio * 100);
                const circumference = 2 * Math.PI * 6;
                return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5 cursor-default">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          className="shrink-0 -rotate-90"
                        >
                          <circle
                            cx="8"
                            cy="8"
                            r="6"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="text-muted-foreground/20"
                          />
                          <circle
                            cx="8"
                            cy="8"
                            r="6"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeDasharray={circumference}
                            strokeDashoffset={circumference * (1 - ratio)}
                            strokeLinecap="round"
                            className={cn(
                              ratio > 0.9
                                ? "text-red-500"
                                : ratio > 0.75
                                  ? "text-yellow-500"
                                  : "text-primary",
                            )}
                          />
                        </svg>
                        <span className="tabular-nums">
                          {formatTokenCount(used)}
                          {limit > 0 && `/${formatTokenCount(limit)}`}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      sideOffset={6}
                      className="text-xs"
                    >
                      {formatTokenCount(used)}
                      {limit > 0 ? ` / ${formatTokenCount(limit)}` : ""} used
                      {limit > 0 ? ` (${pct}%)` : ""}
                    </TooltipContent>
                  </Tooltip>
                );
              })()}
            {data &&
              (() => {
                const displayName = getModelDisplayName(modelName);
                return displayName ? (
                  <span className="truncate text-xs">{displayName}</span>
                ) : null;
              })()}
            {sessionId && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-xs text-muted-foreground hover:text-foreground px-1.5 py-0"
                    disabled={sending}
                  >
                    Done
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  sideOffset={8}
                  align="end"
                  className="w-auto p-3 rounded-lg bg-popover border"
                >
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Mark session as done?
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <PopoverClose asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                        >
                          Cancel
                        </Button>
                      </PopoverClose>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs"
                        onClick={async () => {
                          try {
                            const res = await fetch(
                              `/api/sessions/${sessionId}/complete`,
                              { method: "POST" },
                            );
                            if (res.ok) onClose();
                          } catch (err) {
                            console.error(
                              "Failed to mark session complete:",
                              err,
                            );
                          }
                        }}
                      >
                        Confirm
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

/* ── Main component ────────────────────────────────────── */

export default function SessionDetail({
  sessionId,
  open,
  onOpenChange,
  newSessionDirectory,
  onSessionCreated,
  boardId,
}: SessionDetailProps) {
  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [agents, setAgents] = useState<
    {
      name: string;
      description?: string;
      mode?: string;
      model?: { providerID: string; modelID: string };
    }[]
  >([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const isNewSession = !sessionId && !!newSessionDirectory;
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [width, setWidth] = useState(() => window.innerWidth * 0.5);
  const [children, setChildren] = useState<ChildSession[]>([]);
  const [sessionStatuses, setSessionStatuses] = useState<SessionStatusMap>({});
  const sessionDirRef = useRef<string | null>(null);
  const [activeChildId, setActiveChildId] = useState<string | null>(null);
  const [modelContextLimits, setModelContextLimits] = useState<
    Record<string, number>
  >({});
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const totalRef = useRef(0);
  const prevMessageCountRef = useRef(0);
  const isBusyRef = useRef(false);
  const waitingForResponseRef = useRef(false);
  const isNearBottom = useRef(true);
  const shouldAutoScroll = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const sessionIdRef = useRef<string | null>(sessionId);
  const dataRef = useRef<SessionData | null>(null);
  const sessionCache = useRef<Map<string, SessionData>>(new Map());
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [compacting, setCompacting] = useState(false);

  // Sync mounted/visible states with open — animate in/out
  useEffect(() => {
    if (open) {
      setMounted(true);
      // Double rAF: mount with translate-x-full first, then transition to translate-x-0
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true);
        });
      });
    } else {
      setVisible(false);
      // Allow close animation to play before unmounting
      const timer = setTimeout(() => setMounted(false), 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  // Keep sessionIdRef in sync
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Keep dataRef and cache in sync
  useEffect(() => {
    dataRef.current = data;
    if (data) {
      sessionCache.current.set(data.session_id, data);
      // Evict oldest entries if cache grows too large
      if (sessionCache.current.size > 10) {
        const firstKey = sessionCache.current.keys().next().value;
        if (firstKey) sessionCache.current.delete(firstKey);
      }
    }
  }, [data]);

  // Resize handle
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current =
      panelRef.current?.offsetWidth || window.innerWidth * 0.5;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const delta = startX.current - e.clientX;
    const newWidth = Math.min(
      Math.max(startWidth.current + delta, 320),
      window.innerWidth * 0.85,
    );
    setWidth(newWidth);
  }, []);

  const onPointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Send message
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text || sending) return;
      if (!sessionId && !newSessionDirectory) return;
      setSending(true);

      try {
        let sid = sessionId;
        // Lazy-create session on first message
        if (!sid && newSessionDirectory) {
          const createRes = await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              directory: newSessionDirectory,
              board_id: boardId,
            }),
          });
          if (!createRes.ok)
            throw new Error(`Failed to create session: ${createRes.status}`);
          const newSession = await createRes.json();
          sid = newSession.id;
          if (sid) onSessionCreated?.(sid);
        }
        if (!sid) {
          setSending(false);
          return;
        }
        // Persist agent selection for this session and globally
        if (selectedAgent) {
          saveAgentForSession(sid, selectedAgent);
        }
        const res = await fetch(`/api/sessions/${sid}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, agent: selectedAgent || undefined }),
        });
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        // Immediately unlock the input after receiving acknowledgment (don't wait for body)
        setSending(false);
        // Optimistically show the user's message immediately
        const optimisticMsg: Message = {
          id: `temp-${Date.now()}`,
          role: "user",
          model: null,
          agent: null,
          time_created: Math.floor(Date.now() / 1000),
          text: text,
          reasoning: "",
          tool_calls: [],
        };
        setData((prev) => {
          if (!prev)
            return {
              session_id: sid!,
              title: null,
              directory: "",
              model: "",
              total: 1,
              context_tokens: 0,
              messages: [optimisticMsg],
            };
          return {
            ...prev,
            total: prev.total + 1,
            messages: [...prev.messages, optimisticMsg],
          };
        });
        totalRef.current = (data?.total || 0) + 1;
        waitingForResponseRef.current = true;
        shouldAutoScroll.current = true;
        isNearBottom.current = true;
        setShowScrollButton(false);
      } catch (err) {
        console.error("Failed to send message:", err);
        setSending(false);
        throw err;
      }
    },
    [
      sessionId,
      sending,
      selectedAgent,
      newSessionDirectory,
      onSessionCreated,
      boardId,
      data?.total,
    ],
  );

  // Stop session
  const stopSession = useCallback(async () => {
    const targetId = activeChildId || sessionId;
    if (!targetId) return;
    try {
      const res = await fetch(`/api/opencode/session/${targetId}/abort`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`Failed to abort session: ${res.status}`);
      }
      // Immediately update local state so the UI reflects the abort right away
      waitingForResponseRef.current = false;
      setSessionStatuses((prev) => ({
        ...prev,
        [targetId]: { type: "idle" },
      }));
    } catch (err) {
      console.error("Failed to stop session:", err);
    }
  }, [activeChildId, sessionId]);

  // Fetch session statuses
  const fetchStatuses = useCallback(async (dir?: string | null) => {
    try {
      const statusDir = dir || sessionDirRef.current;
      const res = await fetch(
        `/api/opencode/session/status` +
          (statusDir ? `?directory=${encodeURIComponent(statusDir)}` : ""),
      );
      if (res.ok) {
        const data = await res.json();
        setSessionStatuses(data);
      }
    } catch {
      // status fetch is non-critical
    }
  }, []);

  // Fetch last N messages (all messages for child sessions)
  const fetchMessages = useCallback(
    async (sid: string) => {
      // Only show loading skeleton if we don't already have cached data
      if (!sessionCache.current.has(sid)) {
        setLoading(true);
      }
      setError(null);
      try {
        // Get total count first
        const countRes = await fetch(
          `/api/sessions/${sid}/messages?limit=0&offset=0`,
        );
        if (!countRes.ok) throw new Error(`Failed: ${countRes.status}`);
        const countData = await countRes.json();
        totalRef.current = countData.total;

        // Child sessions: show all messages (no limit). Parent: show last N.
        const isChild = sid !== sessionIdRef.current;
        const limit = isChild ? countData.total : LAST_N;
        const offset = isChild ? 0 : Math.max(0, countData.total - LAST_N);
        const msgRes = await fetch(
          `/api/sessions/${sid}/messages?limit=${limit}&offset=${offset}`,
        );
        if (!msgRes.ok) throw new Error(`Failed: ${msgRes.status}`);
        const msgData = await msgRes.json();
        sessionDirRef.current = msgData.directory;
        setData(msgData);
        // Update cache
        sessionCache.current.set(sid, msgData);
        // Fetch statuses now that we have the directory
        fetchStatuses(msgData.directory);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [fetchStatuses],
  );

  // Load older messages (pagination)
  const loadOlderMessages = useCallback(async () => {
    if (!data || isLoadingMore) return;
    if (!sessionId || activeChildId) return; // Only load for parent session

    const alreadyLoaded = data.messages.length;
    if (alreadyLoaded >= data.total) return; // All messages already loaded

    setIsLoadingMore(true);
    try {
      // Calculate offset for older messages
      const offset = Math.max(0, data.total - alreadyLoaded - LAST_N);
      const limit = LAST_N;

      const res = await fetch(
        `/api/sessions/${sessionId}/messages?limit=${limit}&offset=${offset}`,
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const olderData = await res.json();

      // Preserve scroll position
      const scrollDelta = scrollRef.current
        ? scrollRef.current.scrollHeight - scrollRef.current.scrollTop
        : 0;

      // Prepend older messages
      setData((prev) => {
        if (!prev) return olderData;
        return {
          ...prev,
          messages: [...olderData.messages, ...prev.messages],
        };
      });

      // Prevent auto-scroll from firing after prepending
      prevMessageCountRef.current =
        data.messages.length + olderData.messages.length;

      // Restore scroll position
      queueMicrotask(() => {
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            const newHeight = scrollRef.current.scrollHeight;
            scrollRef.current.scrollTop = newHeight - scrollDelta;
          }
        });
      });
    } catch (err) {
      console.error("Failed to load older messages:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [data, sessionId, activeChildId, isLoadingMore]);

  // Fetch todos
  const fetchTodos = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/opencode/session/${sid}/todo`);
      if (res.ok) {
        const data = await res.json();
        setTodos(Array.isArray(data) ? data : []);
      }
    } catch {
      // todos are non-critical
    }
  }, []);

  // Handle viewing a child session inline
  const handleViewChild = useCallback(
    (childId: string) => {
      setActiveChildId(childId);
      fetchMessages(childId);
      fetchTodos(childId);
    },
    [fetchMessages, fetchTodos],
  );

  // Handle going back to parent session
  const handleBackToParent = useCallback(() => {
    setActiveChildId(null);
    if (sessionId) {
      fetchMessages(sessionId);
      fetchTodos(sessionId);
    }
  }, [sessionId, fetchMessages, fetchTodos]);

  // Compact session context
  const handleCompact = useCallback(async () => {
    if (!sessionId || activeChildId || compacting) return;
    setCompacting(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/compact`, {
        method: "POST",
      });
      if (!res.ok && res.status !== 202) {
        const body = await res
          .json()
          .catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error || `Failed: ${res.status}`);
      }
      // Backend returns 202 — compaction runs asynchronously.
      // Poll until the backend clears the compacting flag.
      const startTime = Date.now();
      const MAX_WAIT = 5 * 60 * 1000; // 5 min safety timeout
      const poll = async () => {
        try {
          const statusRes = await fetch(
            `/api/sessions/${sessionId}/compacting`,
          );
          if (statusRes.ok) {
            const { compacting: stillCompacting } = await statusRes.json();
            if (!stillCompacting) {
              // Done!
              setCompacting(false);
              toast.success("Session compacted");
              fetchMessages(sessionId);
              return;
            }
          }
        } catch {
          /* retry next tick */
        }
        if (Date.now() - startTime > MAX_WAIT) {
          setCompacting(false);
          toast.error("Compaction timed out");
          return;
        }
        setTimeout(poll, 2000);
      };
      // Start polling after a short initial delay
      setTimeout(poll, 1500);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to compact session",
      );
      setCompacting(false);
    }
  }, [sessionId, activeChildId, compacting, fetchMessages]);

  // Fetch child sessions
  const fetchChildren = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/opencode/session/${sid}/children`);
      if (res.ok) {
        const data = await res.json();
        // Sort children by time.updated descending (most recent first)
        const sorted = Array.isArray(data)
          ? data.sort(
              (a: ChildSession, b: ChildSession) =>
                b.time.updated - a.time.updated,
            )
          : [];
        setChildren(sorted);
      }
    } catch {
      // children are non-critical
    }
  }, []);

  // Initial load — delayed until after sheet animation completes
  useEffect(() => {
    if (!open || (!sessionId && !newSessionDirectory)) {
      // Don't clear data on close — keep cached data so reopening is instant.
      // Only reset auxiliary state.
      setTodos([]);
      setChildren([]);
      setSessionStatuses({});
      setActiveChildId(null);
      return;
    }

    // Skip loading when in new session mode (no sessionId yet)
    // Clear stale data so the previous session's messages don't persist
    if (!sessionId) {
      setData(null);
      return;
    }

    const activeSessionId = activeChildId || sessionId;

    // Check cache — if we have data for this session, show it instantly
    const cached = sessionCache.current.get(activeSessionId);
    if (cached) {
      // Restore cached data immediately — no skeleton flash
      setData(cached);
      totalRef.current = cached.total;
      setLoading(false);
      setError(null);
      // Reset scroll tracking for the restored session
      isNearBottom.current = true;
      shouldAutoScroll.current = false;
      hasScrolledToBottomRef.current = false;
    } else {
      // No cache for this session — clear old data and show skeleton
      setData(null);
      setError(null);
      totalRef.current = 0;
      setLoading(true);
    }

    // Delay fetches until after the 200ms slide-in animation finishes
    const timer = setTimeout(() => {
      // Reset scroll tracking so auto-scroll-to-bottom fires for the new session
      prevMessageCountRef.current = 0;
      if (!cached) {
        isNearBottom.current = true;
        shouldAutoScroll.current = false;
        hasScrolledToBottomRef.current = false;
      }

      fetchMessages(activeSessionId);
      fetchTodos(activeSessionId);

      fetchChildren(sessionId);
      fetchStatuses();
    }, 250);

    return () => clearTimeout(timer);
  }, [
    sessionId,
    open,
    activeChildId,
    newSessionDirectory,
    fetchMessages,
    fetchTodos,
    fetchChildren,
    fetchStatuses,
  ]);

  // Fetch agents (merge opencode in-memory + disk-only agents)
  useEffect(() => {
    Promise.all([
      fetch("/api/opencode/agent").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/agents").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([opencodeList, diskList]) => {
        // opencode agents (in-memory, may have richer metadata)
        const ocAgents = (opencodeList || []) as {
          name: string;
          description?: string;
          mode?: string;
          hidden?: boolean;
          model?: { providerID: string; modelID: string };
        }[];

        // Disk-only agents (created after opencode started)
        const diskAgents = (diskList || []) as {
          name: string;
          mode: string;
          description: string;
          model: string | null;
        }[];

        // Merge: start with opencode primaries, add disk-only primaries
        const visible = ocAgents.filter(
          (a) => a.mode !== "subagent" && !a.hidden,
        );
        const knownNames = new Set(visible.map((a) => a.name));

        for (const da of diskAgents) {
          if (da.mode === "primary" && !knownNames.has(da.name)) {
            const modelParts = da.model ? da.model.split("/") : null;
            visible.push({
              name: da.name,
              description: da.description,
              mode: da.mode,
              model:
                modelParts && modelParts.length === 2
                  ? { providerID: modelParts[0], modelID: modelParts[1] }
                  : undefined,
            });
          }
        }

        setAgents(visible);
        if (visible.length > 0) {
          // Restore persisted agent selection
          const saved = getAgentForSession(sessionId || null);
          const isValid = saved && visible.some((a) => a.name === saved);
          if (!selectedAgent) {
            setSelectedAgent(isValid ? saved! : visible[0].name);
          }
        }
      })
      .catch(() => {});
    // Re-fetch agents whenever the sheet opens so deletions/creations are reflected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Restore agent selection when switching sessions
  useEffect(() => {
    if (agents.length === 0) return;
    const saved = getAgentForSession(sessionId || null);
    const isValid = saved && agents.some((a) => a.name === saved);
    if (isValid) {
      setSelectedAgent(saved!);
    } else if (agents.length > 0) {
      setSelectedAgent(agents[0].name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Fetch provider model context limits (once, cached)
  useEffect(() => {
    fetch("/api/opencode/provider")
      .then((r) => r.json())
      .then(
        (data: {
          all: Array<{
            id: string;
            models: Record<string, { limit?: { context?: number } }>;
          }>;
          connected?: string[];
        }) => {
          const limits: Record<string, number> = {};
          for (const provider of data.all) {
            // Only process connected providers (or all if connected not specified)
            if (data.connected && !data.connected.includes(provider.id))
              continue;
            for (const [modelId, model] of Object.entries(provider.models)) {
              const ctx = model.limit?.context;
              if (ctx && !limits[modelId]) {
                limits[modelId] = ctx;
              }
            }
          }
          setModelContextLimits(limits);
        },
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track scroll position for isNearBottom + scroll-to-bottom button
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 150;
    isNearBottom.current = nearBottom;
    setShowScrollButton(!nearBottom && scrollHeight > clientHeight + 300);
  }, []);

  // Compute isBusy at component level (not inside useEffect)
  // This ensures it's available for JSX rendering and polling interval
  const activeId = activeChildId || sessionId;

  // Check if last assistant message has running tool calls (fallback for TUI sessions)
  const hasRunningToolCall =
    data && data.messages.length > 0
      ? data.messages[data.messages.length - 1].tool_calls?.some(
          (tc) => tc.status === "running",
        ) || false
      : false;

  const isBusy = activeId
    ? sessionStatuses[activeId]?.type === "busy" ||
      sessionStatuses[activeId]?.type === "retry" ||
      hasRunningToolCall ||
      waitingForResponseRef.current ||
      compacting
    : false;

  // Pagination: check if we have more messages to load
  const hasMoreMessages = data ? data.messages.length < data.total : false;

  // Filter out empty messages for display
  const visibleMessages = useMemo(() => {
    if (!data) return [];
    return data.messages.filter(
      (msg) =>
        msg.text ||
        msg.reasoning ||
        (msg.tool_calls && msg.tool_calls.length > 0) ||
        (msg.compactions && msg.compactions.length > 0),
    );
  }, [data]);

  // Setup virtualizer — use scrollToOffset on mount to start at bottom
  const hasScrolledToBottomRef = useRef(false);
  const virtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 100,
    getItemKey: (index) => visibleMessages[index]?.id ?? index,
    measureElement:
      typeof window !== "undefined"
        ? (element) => element?.getBoundingClientRect().height
        : undefined,
    overscan: 5,
    // Start scrolled to bottom: set offset to huge value, clamps to max scroll
    initialOffset: visibleMessages.length > 0 ? Number.MAX_SAFE_INTEGER : 0,
  });

  // Mark that we've done the initial bottom scroll (via initialOffset)
  // after the virtualizer has actually rendered the items.
  useLayoutEffect(() => {
    if (visibleMessages.length > 0 && !hasScrolledToBottomRef.current) {
      hasScrolledToBottomRef.current = true;
    }
  }, [visibleMessages.length]);

  // Auto-scroll to bottom during streaming and new messages
  // Derive a streaming key that changes when the last message's text grows
  const lastMsgTextLen =
    data && data.messages.length > 0
      ? (data.messages[data.messages.length - 1].text?.length ?? 0)
      : 0;
  const msgCount = data?.messages.length ?? 0;

  useEffect(() => {
    if (!data || !scrollRef.current) return;
    // Skip the initial mount scroll — handled by initialOffset above
    if (!hasScrolledToBottomRef.current) return;

    // Determine if we should auto-scroll:
    // 1. Always scroll if user explicitly sent a message (shouldAutoScroll flag)
    // 2. Or scroll if user is near bottom (covers new messages AND streaming text updates)
    const shouldScroll = shouldAutoScroll.current || isNearBottom.current;

    if (shouldScroll) {
      shouldAutoScroll.current = false; // Reset flag after use
      const lastIdx = visibleMessages.length - 1;
      if (lastIdx >= 0) {
        requestAnimationFrame(() => {
          virtualizer.scrollToIndex(lastIdx, {
            align: "end",
            behavior: "smooth",
          });
        });
      }
    }
  }, [msgCount, lastMsgTextLen, open, visibleMessages.length, virtualizer]);

  // Compute context limit based on model
  const modelStr = data
    ? typeof data.model === "string"
      ? data.model
      : data.model && typeof data.model === "object"
        ? data.model.modelID || ""
        : ""
    : "";
  const contextLimit = modelContextLimits[modelStr] || 0;

  // SSE-driven real-time streaming — no polling
  useEffect(() => {
    if (!open || !sessionId) return;

    // Keep ref in sync with current busy state
    isBusyRef.current = isBusy;

    // Sync auxiliary data (todos, children, statuses) after message completion
    const syncAfterCompletion = async () => {
      if (!sessionId) return;
      try {
        const activeSessionId = activeChildId || sessionId;

        // Fetch authoritative messages from DB
        const countRes = await fetch(
          `/api/sessions/${activeSessionId}/messages?limit=0&offset=0`,
        );
        if (!countRes.ok) return;
        const countData = await countRes.json();
        const newTotal = countData.total;

        if (newTotal > totalRef.current) {
          const prevData = dataRef.current;
          const currentlyLoaded = prevData?.messages?.length || LAST_N;
          const oldTotal = totalRef.current;
          const startOffset = Math.max(0, oldTotal - currentlyLoaded);
          totalRef.current = newTotal;

          const fetchLimit = newTotal - startOffset;
          const msgRes = await fetch(
            `/api/sessions/${activeSessionId}/messages?limit=${fetchLimit}&offset=${startOffset}`,
          );
          if (msgRes.ok) {
            const msgData = await msgRes.json();
            setData(msgData);
          }
        }

        // Refresh todos, children, statuses
        const todoRes = await fetch(
          `/api/opencode/session/${activeSessionId}/todo`,
        );
        if (todoRes.ok) {
          const todoData = await todoRes.json();
          setTodos(Array.isArray(todoData) ? todoData : []);
        }

        const childRes = await fetch(
          `/api/opencode/session/${sessionId}/children`,
        );
        if (childRes.ok) {
          const childData = await childRes.json();
          const sorted = Array.isArray(childData)
            ? childData.sort(
                (a: ChildSession, b: ChildSession) =>
                  b.time.updated - a.time.updated,
              )
            : [];
          setChildren(sorted);
        }

        const dir = sessionDirRef.current;
        const statusRes = await fetch(
          `/api/opencode/session/status` +
            (dir ? `?directory=${encodeURIComponent(dir)}` : ""),
        );
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          setSessionStatuses(statusData);
        }
      } catch {
        // ignore — next completion event will retry
      }
    };

    // SSE for real-time streaming updates + session status
    const es = new EventSource("/api/events");
    es.onmessage = (event) => {
      try {
        const eventData = JSON.parse(event.data);
        const activeId = activeChildId || sessionId;

        if (
          eventData.type === "opencode_session_status" &&
          eventData.sessionID
        ) {
          setSessionStatuses((prev) => ({
            ...prev,
            [eventData.sessionID]: eventData.status,
          }));
          if (
            eventData.sessionID === activeId &&
            eventData.status?.type !== "busy" &&
            eventData.status?.type !== "retry"
          ) {
            waitingForResponseRef.current = false;
          }
          return;
        }

        // Handle incremental text deltas (efficient streaming)
        if (
          eventData.type === "opencode_message_part_delta" &&
          eventData.sessionID === activeId
        ) {
          const { field, delta } = eventData;

          setData((prev) => {
            if (!prev) return prev;
            const messages = [...prev.messages];
            if (messages.length === 0) return prev;

            const lastMsg = messages[messages.length - 1];

            if (lastMsg.role === "user") {
              const newMsg: Message = {
                id: "streaming-" + Date.now(),
                role: "assistant",
                model:
                  typeof prev.model === "string"
                    ? prev.model
                    : prev.model?.modelID || null,
                agent: null,
                time_created: Date.now() / 1000,
                text: field === "text" ? delta : "",
                reasoning: field === "reasoning" ? delta : "",
                tool_calls: [],
              };
              messages.push(newMsg);
            } else {
              const updated = { ...lastMsg };
              if (field === "text") {
                updated.text = (updated.text || "") + delta;
              } else if (field === "reasoning") {
                updated.reasoning = (updated.reasoning || "") + delta;
              }
              messages[messages.length - 1] = updated;
            }

            return { ...prev, messages, context_tokens: prev.context_tokens };
          });
          return;
        }

        // Handle streaming message part updates (tool progress, full text sync)
        if (
          eventData.type === "opencode_message_part_updated" &&
          eventData.sessionID === activeId &&
          eventData.part
        ) {
          const part = eventData.part;
          setData((prev) => {
            if (!prev) return prev;
            const messages = [...prev.messages];
            if (messages.length === 0) return prev;

            const lastMsg = messages[messages.length - 1];

            if (lastMsg.role === "user") {
              const newMsg: Message = {
                id: "streaming-" + Date.now(),
                role: "assistant",
                model:
                  typeof prev.model === "string"
                    ? prev.model
                    : prev.model?.modelID || null,
                agent: eventData?.agent || part?.agent || null,
                time_created: Date.now() / 1000,
                text: part.type === "text" ? stripMandatoryTags(part.text) : "",
                reasoning: "",
                tool_calls:
                  part.type === "tool"
                    ? [
                        {
                          tool: part.tool || "unknown",
                          callID: part.callID || "",
                          status:
                            (part.state?.status as ToolCall["status"]) ||
                            "running",
                          input: part.state?.input || {},
                          output: part.state?.metadata?.output || "",
                        },
                      ]
                    : [],
              };
              messages.push(newMsg);
            } else {
              const updated = { ...lastMsg };
              if (part.type === "text" && part.text !== undefined) {
                updated.text = stripMandatoryTags(part.text);
              } else if (part.type === "tool" && part.callID) {
                const toolCalls = [...(updated.tool_calls || [])];
                const idx = toolCalls.findIndex(
                  (tc) => tc.callID === part.callID,
                );
                const newTc: ToolCall = {
                  tool:
                    part.tool || (idx >= 0 ? toolCalls[idx].tool : "unknown"),
                  callID: part.callID,
                  status:
                    (part.state?.status as ToolCall["status"]) ||
                    (idx >= 0 ? toolCalls[idx].status : "running"),
                  input:
                    part.state?.input || (idx >= 0 ? toolCalls[idx].input : {}),
                  output:
                    part.state?.metadata?.output ||
                    (idx >= 0 ? toolCalls[idx].output : ""),
                };
                if (idx >= 0) {
                  toolCalls[idx] = newTc;
                } else {
                  toolCalls.push(newTc);
                }
                updated.tool_calls = toolCalls;
              }
              messages[messages.length - 1] = updated;
            }

            return { ...prev, messages, context_tokens: prev.context_tokens };
          });
          return;
        }

        // Handle message completion — sync authoritative DB state
        if (
          eventData.type === "opencode_message_updated" &&
          eventData.sessionID === activeId
        ) {
          syncAfterCompletion();
          return;
        }
      } catch {}
    };

    es.onerror = () => {
      // SSE disconnected — will auto-reconnect by browser EventSource spec
    };

    return () => {
      es.close();
    };
  }, [open, sessionId, activeChildId]);

  // Clear waitingForResponseRef only when the agent response is truly complete.
  // We do NOT clear on user messages because the optimistic user message added
  // by sendMessage triggers this effect immediately, causing a flicker where
  // isBusy → false → true. Instead, the ref is cleared by:
  //   1. Session status polling confirming idle (in the polling effect above)
  //   2. A completed assistant response with no running tool calls
  useEffect(() => {
    if (!waitingForResponseRef.current || !data) return;
    const lastMsg = data.messages[data.messages.length - 1];
    if (!lastMsg) return;
    if (lastMsg.role === "assistant") {
      const hasRunning =
        lastMsg.tool_calls?.some((tc) => tc.status === "running") || false;
      if (!hasRunning) {
        waitingForResponseRef.current = false;
      }
    }
  }, [data]);

  if (!mounted) return null;

  return (
    <>
      <style>{`
        @keyframes loading-bar {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-200",
          visible ? "opacity-100" : "opacity-0",
        )}
        onClick={() => onOpenChange(false)}
      />

      {/* Resizable Panel */}
      <div
        ref={panelRef}
        style={{ width: `${width}px` }}
        className={cn(
          "fixed top-0 right-0 z-50 h-full bg-background border-l shadow-lg flex flex-col",
          "transition-transform duration-200 ease-in-out",
          visible ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Resize Handle */}
        <div
          className="absolute top-0 left-0 h-full w-2 -translate-x-1/2 cursor-col-resize flex items-center justify-center hover:bg-accent/50 transition-colors"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <GripVertical className="w-3 h-3 text-muted-foreground/50" />
        </div>

        {/* Header */}
        <div className="border-b px-6 py-3 flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              {activeChildId && (
                <button
                  onClick={handleBackToParent}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight className="w-3 h-3 rotate-180" />
                  Back
                </button>
              )}
              <h2 className="text-sm font-semibold truncate">
                {(() => {
                  if (isNewSession) return "New Session";
                  const activeChild = activeChildId
                    ? children.find((c) => c.id === activeChildId)
                    : null;
                  return activeChild
                    ? activeChild.title
                    : data?.title || "Untitled Session";
                })()}
              </h2>
            </div>
            {(activeChildId || sessionId) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="text-[10px] text-muted-foreground/40 font-mono truncate w-fit hover:text-muted-foreground transition-colors cursor-pointer text-left"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          activeChildId || sessionId || "",
                        );
                        toast.success("Session ID copied");
                      } catch {}
                    }}
                  >
                    {activeChildId || sessionId}
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  sideOffset={4}
                  className="text-xs"
                >
                  Click to copy session ID
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-2">
            {sessionId && !activeChildId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCompact}
                    disabled={compacting}
                    className="h-6 w-6 p-0"
                  >
                    <Shrink
                      className={cn("w-4 h-4", compacting && "animate-spin")}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  sideOffset={4}
                  className="text-xs"
                >
                  Compact session context
                </TooltipContent>
              </Tooltip>
            )}
            {sessionId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                className="h-6 w-6 p-0"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-6 w-6 p-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden"
          onScroll={handleScroll}
        >
          {loading && !data ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-3/4" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : error ? (
            <div className="p-4 text-sm text-destructive">Error: {error}</div>
          ) : data && data.messages.length > 0 ? (
            <>
              {/* Load older messages button */}
              {hasMoreMessages && !activeChildId && (
                <div className="text-center py-3 px-4">
                  <button
                    onClick={loadOlderMessages}
                    disabled={isLoadingMore}
                    className="text-xs px-3 py-1.5 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoadingMore
                      ? "Loading…"
                      : `Load older messages (${data.total - data.messages.length} more)`}
                  </button>
                </div>
              )}

              {/* Virtualized message list */}
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const msg = visibleMessages[virtualRow.index];
                  const msgIndex = data.messages.indexOf(msg);
                  const prevMsg =
                    msgIndex > 0 ? data.messages[msgIndex - 1] : undefined;
                  const nextMsg =
                    msgIndex < data.messages.length - 1
                      ? data.messages[msgIndex + 1]
                      : undefined;
                  const isLast = msgIndex === data.messages.length - 1;

                  return (
                    <div
                      key={msg.id || virtualRow.index}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <MessageRow
                        msg={msg}
                        prevMsg={prevMsg}
                        nextMsg={nextMsg}
                        isLast={isLast}
                        sessionStatuses={sessionStatuses}
                        children={children}
                        onViewChild={handleViewChild}
                        sessionId={activeChildId || sessionId || ""}
                        directory={
                          data?.directory ?? newSessionDirectory ?? null
                        }
                        isBusy={isBusy}
                        isLastAssistant={msg.role === "assistant" && isLast}
                        onAnswerSubmitted={() => {
                          // Trigger a poll to refresh messages
                          waitingForResponseRef.current = true;
                          shouldAutoScroll.current = true;
                          isNearBottom.current = true;
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                {isNewSession ? (
                  <>
                    <div className="mb-3">
                      <Sparkles className="w-10 h-10 text-muted-foreground/30 mx-auto" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      What can I help you with?
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mb-3">
                      <MessageCircle className="w-10 h-10 text-muted-foreground/30 mx-auto" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      No messages yet
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <div className="relative">
            <button
              onClick={() => {
                const lastIdx = visibleMessages.length - 1;
                if (lastIdx >= 0) {
                  virtualizer.scrollToIndex(lastIdx, {
                    align: "end",
                    behavior: "smooth",
                  });
                }
                isNearBottom.current = true;
                setShowScrollButton(false);
              }}
              className="absolute -top-12 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/90 border shadow-md text-xs text-muted-foreground hover:text-foreground hover:bg-background transition-colors backdrop-blur-sm"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              Scroll to bottom
            </button>
          </div>
        )}

        {/* Todos + Message Input */}
        <div className="border-t flex-shrink-0">
          {/* Todos */}
          <TodoPanel todos={todos} />
          {/* Input section — only for parent session */}
          {!activeChildId && (
            <ChatInput
              sending={sending}
              isBusy={isBusy}
              agents={agents}
              selectedAgent={selectedAgent}
              onAgentChange={setSelectedAgent}
              onSend={sendMessage}
              onStop={stopSession}
              contextTokens={data?.context_tokens || 0}
              contextLimit={contextLimit}
              modelName={modelStr}
              sessionId={sessionId}
              onClose={() => onOpenChange(false)}
              data={data}
              directory={data?.directory ?? newSessionDirectory ?? null}
            />
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {confirmDelete &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
            <div className="bg-popover text-popover-foreground rounded-lg border p-4 shadow-lg max-w-sm mx-4 space-y-3">
              <h3 className="font-semibold text-sm">Delete session</h3>
              <p className="text-sm text-muted-foreground">
                Permanently delete this session and all its messages? This
                cannot be undone.
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
                  onClick={async () => {
                    try {
                      const response = await fetch(
                        `/api/sessions/${sessionId}`,
                        { method: "DELETE" },
                      );
                      if (response.ok) {
                        toast.success("Session deleted");
                        setConfirmDelete(false);
                        onOpenChange(false);
                      } else {
                        toast.error("Failed to delete session");
                      }
                    } catch (error) {
                      toast.error("Error deleting session");
                    }
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
