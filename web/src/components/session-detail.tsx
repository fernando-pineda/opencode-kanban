import {
  useEffect,
  useState,
  useRef,
  useCallback,
  type ComponentPropsWithoutRef,
  memo,
  useMemo,
} from "react";
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
  CheckCircle2,
  Clock,
  ListTodo,
  Shrink,
  ArrowRight,
  Square,
  HelpCircle,
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
import { cn } from "@/lib/utils";

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

const ProsePre = ({ children, ...props }: ComponentPropsWithoutRef<"pre">) => (
  <pre
    {...props}
    className="bg-muted text-muted-foreground rounded-md p-3 text-xs overflow-x-auto my-2 leading-relaxed"
  >
    {children}
  </pre>
);

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
  onAnswerSubmitted,
}: {
  toolCall: ToolCall;
  sessionId: string;
  onAnswerSubmitted: () => void;
}) {
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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
      // Build answer text
      const answerParts: string[] = [];
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const selected = answers[i] || [];
        const custom = customAnswers[i]?.trim();
        if (selected.length > 0 && custom) {
          answerParts.push(`**${q.header}**: ${selected.join(", ")} — ${custom}`);
        } else if (selected.length > 0) {
          answerParts.push(`**${q.header}**: ${selected.join(", ")}`);
        } else if (custom) {
          answerParts.push(`**${q.header}**: ${custom}`);
        }
      }
      if (answerParts.length === 0) return;
      const answerText = answerParts.join("\n");

      const res = await fetch(`/api/sessions/${sessionId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: answerText }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setSubmitted(true);
      onAnswerSubmitted();
    } catch (err) {
      console.error("Failed to submit answer:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const allAnswered = questions.every(
    (_, i) => (answers[i]?.length || 0) > 0 || customAnswers[i]?.trim()
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
                        : "border-muted bg-background hover:bg-muted/50"
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
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {submitting ? "Submitting…" : "Submit Answers"}
        </button>
      </div>
    </div>
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
  onAnswerSubmitted,
}: {
  msg: Message;
  prevMsg?: Message;
  nextMsg?: Message;
  isLast: boolean;
  sessionStatuses: Record<string, { type: string }>;
  children: ChildSession[];
  onViewChild: (childId: string) => void;
  sessionId: string;
  onAnswerSubmitted: () => void;
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
      {msg.reasoning && (
        <Collapsible defaultOpen>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors py-0.5">
              <ChevronDown className="w-3 h-3" />
              Thinking…
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="text-xs text-muted-foreground/60 italic pl-4 py-1 border-l-2 border-muted whitespace-pre-wrap">
              {msg.reasoning}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Text content */}
      {msg.text && (
        <div
          className={cn(
            "rounded-lg px-3 py-2",
            msg.role === "user"
              ? "bg-primary text-primary-foreground ml-auto max-w-[85%]"
              : "text-foreground",
          )}
        >
          <div className="text-sm">
            <MarkdownContent
              content={msg.role === "user" ? stripMandatoryTags(msg.text) : msg.text}
              className={cn(
                msg.role === "user" &&
                  "[&_a]:text-primary-foreground/80 [&_a]:underline",
              )}
            />
          </div>
        </div>
      )}

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
                  onAnswerSubmitted={onAnswerSubmitted}
                />
              );
            }

            if (toolCall.tool === "task") {
              // Try to get taskId from output first
              let taskId = extractTaskId(toolCall.output);
              
              // If no taskId from output, try to match child from children array by description
              if (!taskId) {
                const description = (toolCall.input as Record<string, string>)?.description;
                if (description) {
                  const matchingChild = children.find(
                    (c) => c.title === description || c.title?.includes(description)
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
  const [open, setOpen] = useState(true);
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
  const [inputValue, setInputValue] = useState("");
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
  const [activeChildId, setActiveChildId] = useState<string | null>(null);
  const [modelContextLimits, setModelContextLimits] = useState<Record<string, number>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
  const [isLoadingMore, setIsLoadingMore] = useState(false);

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
  const sendMessage = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || sending) return;
    if (!sessionId && !newSessionDirectory) return;
    setSending(true);
    setInputValue("");
    try {
      let sid = sessionId;
      // Lazy-create session on first message
      if (!sid && newSessionDirectory) {
        const createRes = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ directory: newSessionDirectory, board_id: boardId }),
        });
         if (!createRes.ok) throw new Error(`Failed to create session: ${createRes.status}`);
         const newSession = await createRes.json();
         sid = newSession.id;
         if (sid) onSessionCreated?.(sid);
      }
       if (!sid) return;
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
          if (!prev) return { session_id: sid!, title: null, directory: "", model: "", total: 1, context_tokens: 0, messages: [optimisticMsg] };
          return { ...prev, total: prev.total + 1, messages: [...prev.messages, optimisticMsg] };
         });
        totalRef.current = (data?.total || 0) + 1;
        waitingForResponseRef.current = true;
        shouldAutoScroll.current = true;
        isNearBottom.current = true;
    } catch (err) {
      console.error("Failed to send message:", err);
      setInputValue(text);
      setSending(false);
    } finally {
      inputRef.current?.focus();
    }
  }, [inputValue, sessionId, sending, selectedAgent, newSessionDirectory, onSessionCreated, boardId]);

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
      // Success - the polling will detect the status change from "busy" to "idle"
    } catch (err) {
      console.error("Failed to stop session:", err);
    }
  }, [activeChildId, sessionId]);

  // Fetch last N messages (all messages for child sessions)
  const fetchMessages = useCallback(async (sid: string) => {
    setLoading(true);
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
      const isChild = sid !== sessionId;
      const limit = isChild ? countData.total : LAST_N;
      const offset = isChild ? 0 : Math.max(0, countData.total - LAST_N);
      const msgRes = await fetch(
        `/api/sessions/${sid}/messages?limit=${limit}&offset=${offset}`,
      );
      if (!msgRes.ok) throw new Error(`Failed: ${msgRes.status}`);
      const msgData = await msgRes.json();
      setData(msgData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

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
      prevMessageCountRef.current = data.messages.length + olderData.messages.length;
      
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
  const handleViewChild = useCallback((childId: string) => {
    setActiveChildId(childId);
    fetchMessages(childId);
    fetchTodos(childId);
  }, [fetchMessages, fetchTodos]);

  // Handle going back to parent session
  const handleBackToParent = useCallback(() => {
    setActiveChildId(null);
    if (sessionId) {
      fetchMessages(sessionId);
      fetchTodos(sessionId);
    }
  }, [sessionId, fetchMessages, fetchTodos]);

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

  // Fetch session statuses
  const fetchStatuses = useCallback(async () => {
    try {
      const res = await fetch(`/api/opencode/session/status`);
      if (res.ok) {
        const data = await res.json();
        setSessionStatuses(data);
      }
    } catch {
      // status fetch is non-critical
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (!open || (!sessionId && !newSessionDirectory)) {
      setData(null);
      setError(null);
      setTodos([]);
      setChildren([]);
      setSessionStatuses({});
      totalRef.current = 0;
      setActiveChildId(null);
      return;
    }
    
    // Skip loading when in new session mode (no sessionId yet)
    if (!sessionId) {
      return;
    }
    
    const activeSessionId = activeChildId || sessionId;
    fetchMessages(activeSessionId);
    fetchTodos(activeSessionId);
    
    // Only fetch children and statuses for the parent session
    if (!activeChildId) {
      fetchChildren(sessionId);
      fetchStatuses();
    }
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

  // Fetch agents
  useEffect(() => {
    fetch("/api/opencode/agent")
      .then((r) => r.json())
      .then(
        (
          list: {
            name: string;
            description?: string;
            mode?: string;
            hidden?: boolean;
            model?: { providerID: string; modelID: string };
          }[],
        ) => {
          // Match opencode CLI: exclude subagent + hidden agents
          const visible = list.filter(
            (a) => a.mode !== "subagent" && !a.hidden,
          );
          setAgents(visible);
          if (visible.length > 0) {
            // Restore persisted agent selection
            const saved = getAgentForSession(sessionId || null);
            const isValid = saved && visible.some((a) => a.name === saved);
            if (!selectedAgent) {
              setSelectedAgent(isValid ? saved! : visible[0].name);
            }
          }
        },
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            if (data.connected && !data.connected.includes(provider.id)) continue;
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

  // Track scroll position for isNearBottom
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isNearBottom.current = scrollHeight - scrollTop - clientHeight < 150;
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (!data || !scrollRef.current) return;

    const currentMessageCount = data.messages.length;

    // Determine if we should auto-scroll:
    // 1. Always scroll if user explicitly sent a message (shouldAutoScroll flag)
    // 2. Or scroll if new message arrives AND user is near bottom
    const shouldScroll = shouldAutoScroll.current || (currentMessageCount !== prevMessageCountRef.current && isNearBottom.current);

    prevMessageCountRef.current = currentMessageCount;

    if (shouldScroll) {
      shouldAutoScroll.current = false; // Reset flag after use
      // First rAF: let virtualizer render items, then scroll to estimated bottom.
      // Second rAF: virtualizer has now measured actual sizes and re-rendered,
      // so scrollHeight is accurate — scroll to the real bottom.
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          requestAnimationFrame(() => {
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          });
        }
      });
    }
  }, [data?.messages.length, open]);

   // Compute isBusy at component level (not inside useEffect)
    // This ensures it's available for JSX rendering and polling interval
    const activeId = activeChildId || sessionId;
    
    // Check if last assistant message has running tool calls (fallback for TUI sessions)
    const hasRunningToolCall = data && data.messages.length > 0 
      ? data.messages[data.messages.length - 1].tool_calls?.some(tc => tc.status === "running") || false
      : false;

    const isBusy = activeId 
      ? (sessionStatuses[activeId]?.type === "busy" || sessionStatuses[activeId]?.type === "retry" || hasRunningToolCall || waitingForResponseRef.current) 
      : false;

    // Pagination: check if we have more messages to load
    const hasMoreMessages = data ? data.messages.length < data.total : false;

    // Filter out empty messages for display
    const visibleMessages = useMemo(() => {
      if (!data) return [];
      return data.messages.filter((msg) => 
        msg.text || msg.reasoning || (msg.tool_calls && msg.tool_calls.length > 0) || (msg.compactions && msg.compactions.length > 0)
      );
    }, [data]);

    // Setup virtualizer
    const virtualizer = useVirtualizer({
      count: visibleMessages.length,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => 100,
      measureElement: typeof window !== "undefined" ? (element) => element?.getBoundingClientRect().height : undefined,
      overscan: 5,
    });

    // Compute context limit based on model
    const modelStr = data
      ? typeof data.model === "string"
        ? data.model
        : (data.model && typeof data.model === "object")
          ? data.model.modelID || ""
          : ""
      : "";
     const contextLimit = modelContextLimits[modelStr] || 0;
    const LINE_HEIGHT = 20;
    const MAX_TEXTAREA_HEIGHT = LINE_HEIGHT * 4 + 16;

  // Realtime polling — refetch last N messages + todos + children
  useEffect(() => {
    if (!open || !sessionId) return;

    // Keep ref in sync with current busy state
    isBusyRef.current = isBusy;

    const poll = async () => {
      if (!sessionId) return;
      try {
        const activeSessionId = activeChildId || sessionId;
        
        // Check for new messages
        const countRes = await fetch(
          `/api/sessions/${activeSessionId}/messages?limit=0&offset=0`,
        );
        if (!countRes.ok) return;
        const countData = await countRes.json();
        const newTotal = countData.total;

        if (newTotal > totalRef.current) {
          totalRef.current = newTotal;
          // Refetch last N
          const offset = Math.max(0, newTotal - LAST_N);
          const msgRes = await fetch(
            `/api/sessions/${activeSessionId}/messages?limit=${LAST_N}&offset=${offset}`,
          );
          if (msgRes.ok) {
            const msgData = await msgRes.json();
            setData(msgData);
          }
        } else if (newTotal > 0) {
          // No new messages but refetch tail-3 for streaming updates
          const tailCount = Math.min(3, newTotal);
          const tailOffset = newTotal - tailCount;
          const tailRes = await fetch(
            `/api/sessions/${activeSessionId}/messages?limit=${tailCount}&offset=${tailOffset}`,
          );
          if (tailRes.ok) {
            const tailData = await tailRes.json();
            setData((prev) => {
              if (!prev) return tailData;

              // Compare: only update if the last message ID or text has changed
              const lastTailMsg =
                tailData.messages[tailData.messages.length - 1];
              const lastPrevMsg = prev.messages[prev.messages.length - 1];

              const toolStatusEqual =
                JSON.stringify(
                  lastTailMsg.tool_calls?.map((tc: ToolCall) => ({
                    id: tc.callID,
                    status: tc.status,
                  })),
                ) ===
                JSON.stringify(
                  lastPrevMsg.tool_calls?.map((tc: ToolCall) => ({
                    id: tc.callID,
                    status: tc.status,
                  })),
                );
              if (
                lastTailMsg &&
                lastPrevMsg &&
                lastTailMsg.id === lastPrevMsg.id &&
                lastTailMsg.text === lastPrevMsg.text &&
                toolStatusEqual
              ) {
                // No meaningful changes detected, skip update
                return prev;
              }

              const base = prev.messages.slice(0, -tailCount);
              return {
                ...prev,
                total: newTotal,
                messages: [...base, ...tailData.messages],
              };
            });
           }
          }

          // Also refresh todos
        const todoRes = await fetch(`/api/opencode/session/${activeSessionId}/todo`);
        if (todoRes.ok) {
          const todoData = await todoRes.json();
          setTodos(Array.isArray(todoData) ? todoData : []);
        }

        // Always refresh children and statuses (using parent sessionId)
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

        const statusRes = await fetch(`/api/opencode/session/status`);
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          setSessionStatuses(statusData);
        }
      } catch {
        // next poll will retry
      }
    };

    // Determine interval based on session status: 1000ms when busy, 2000ms when idle
    // Use ref to avoid stale closure issues with isBusy
    const pollInterval = isBusyRef.current ? 1000 : 2000;

    const interval = setInterval(poll, pollInterval);

    // SSE for immediate triggers
    const es = new EventSource("/api/events");
    es.onmessage = () => poll();

    return () => {
      clearInterval(interval);
      es.close();
    };
  }, [open, sessionId, activeChildId, isBusy]);

  // Clear waitingForResponseRef when data updates show the response has arrived
  // This must be a separate effect from polling so it uses fresh data (not stale closure)
  useEffect(() => {
    if (!waitingForResponseRef.current || !data) return;
    const lastMsg = data.messages[data.messages.length - 1];
    if (!lastMsg) return;
    if (lastMsg.role === "user") {
      // User message appeared (our answer was received) — clear the flag;
      // session status polling will track the ongoing busy state
      waitingForResponseRef.current = false;
    } else if (lastMsg.role === "assistant") {
      const hasRunning = lastMsg.tool_calls?.some(tc => tc.status === "running") || false;
      if (!hasRunning) {
        waitingForResponseRef.current = false;
      }
    }
  }, [data]);


  if (!open) return null;

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
        className="fixed inset-0 z-40 bg-black/50"
        onClick={() => onOpenChange(false)}
      />

      {/* Resizable Panel */}
      <div
        ref={panelRef}
        style={{ width: `${width}px` }}
        className={cn(
          "fixed top-0 right-0 z-50 h-full bg-background border-l shadow-lg flex flex-col",
          "animate-in slide-in-from-right duration-200",
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
                  return activeChild ? activeChild.title : (data?.title || "Untitled Session");
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
                        await navigator.clipboard.writeText(activeChildId || sessionId || "");
                        toast.success("Session ID copied");
                      } catch {}
                    }}
                  >
                    {activeChildId || sessionId}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4} className="text-xs">
                  Click to copy session ID
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-6 w-6 p-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden"
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
                    {isLoadingMore ? "Loading…" : `Load older messages (${data.total - data.messages.length} more)`}
                  </button>
                </div>
              )}
              
              {/* Virtualized message list */}
              <div style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const msg = visibleMessages[virtualRow.index];
                  const msgIndex = data.messages.indexOf(msg);
                  const prevMsg = msgIndex > 0 ? data.messages[msgIndex - 1] : undefined;
                  const nextMsg = msgIndex < data.messages.length - 1 ? data.messages[msgIndex + 1] : undefined;
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
            <div className="p-4 text-sm text-muted-foreground">
              {isNewSession ? "Start a conversation…" : "No messages yet"}
            </div>
          )}
        </div>

        {/* Todos + Message Input */}
        <div className="border-t flex-shrink-0">
          {/* Todos */}
          <TodoPanel todos={todos} />
            {/* Input section — only for parent session */}
             {!activeChildId && (
               <div className="px-4 pt-3 pb-3">
                 {/* Input container with all elements inside */}
                 <div className="relative bg-input rounded-md">
                   <textarea
                     ref={inputRef}
                     value={inputValue}
                     onChange={(e) => {
                       setInputValue(e.target.value);
                       const el = e.target;
                       el.style.height = "auto";
                       el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
                     }}
                     onKeyDown={(e) => {
                       if (e.key === "Enter" && !e.shiftKey) {
                         e.preventDefault();
                         sendMessage();
                       }
                       if (e.key === "Tab" && agents.length > 1) {
                         e.preventDefault();
                         const currentIdx = agents.findIndex((a) => a.name === selectedAgent);
                         const nextIdx = (currentIdx + 1) % agents.length;
                         setSelectedAgent(agents[nextIdx].name);
                       }
                     }}
                     onFocus={() => {
                       if (inputRef.current && inputRef.current.value !== inputValue) {
                         setInputValue("");
                         inputRef.current.value = "";
                       }
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
                       isBusy && "pr-10"
                     )}
                   />
                   
                   {/* Stop button — top right, inside textarea */}
                   {isBusy && (
                     <button
                       onClick={() => stopSession()}
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
                     {/* Left side: mode indicator + TAB icon */}
                     <div className="flex items-center gap-2">
                       {agents.length > 0 && (
                         <div className="flex items-center gap-1.5">
                           <span>{toCamelCase(selectedAgent)}</span>
                           <kbd className="inline-flex items-center justify-center h-5 w-5 rounded border border-muted-foreground/30 bg-muted/20 text-[10px] font-mono">
                             ⇥
                           </kbd>
                         </div>
                       )}
                     </div>
                     
                     {/* Right side: context tokens + model name + Done button */}
                     <div className="flex items-center gap-2">
                       {data && (() => {
                         const used = data.context_tokens || 0;
                         const limit = contextLimit;
                         const ratio = limit > 0 ? Math.min(used / limit, 1) : 0;
                         const pct = Math.round(ratio * 100);
                         const circumference = 2 * Math.PI * 6;
                         return (
                           <Tooltip>
                             <TooltipTrigger asChild>
                               <div className="flex items-center gap-1.5 cursor-default">
                                 <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0 -rotate-90">
                                   <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/20" />
                                   <circle
                                     cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2"
                                     strokeDasharray={circumference}
                                     strokeDashoffset={circumference * (1 - ratio)}
                                     strokeLinecap="round"
                                     className={cn(
                                       ratio > 0.9
                                         ? "text-red-500"
                                         : ratio > 0.75
                                           ? "text-yellow-500"
                                           : "text-primary"
                                     )}
                                   />
                                 </svg>
                                 <span className="tabular-nums">
                                   {formatTokenCount(used)}
                                   {limit > 0 && `/${formatTokenCount(limit)}`}
                                 </span>
                               </div>
                             </TooltipTrigger>
                             <TooltipContent side="top" sideOffset={6} className="text-xs">
                               {formatTokenCount(used)}{limit > 0 ? ` / ${formatTokenCount(limit)}` : ""} used{limit > 0 ? ` (${pct}%)` : ""}
                             </TooltipContent>
                           </Tooltip>
                         );
                       })()}
                       {data && (() => {
                         const displayName = getModelDisplayName(modelStr);
                         return displayName ? <span className="truncate text-xs">{displayName}</span> : null;
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
                               <p className="text-xs text-muted-foreground">Mark session as done?</p>
                               <div className="flex items-center justify-end gap-2">
                                 <PopoverClose asChild>
                                   <Button variant="ghost" size="sm" className="h-7 text-xs">
                                     Cancel
                                   </Button>
                                 </PopoverClose>
                                 <Button
                                   size="sm"
                                   variant="destructive"
                                   className="h-7 text-xs"
                                   onClick={async () => {
                                     try {
                                       const res = await fetch(`/api/sessions/${sessionId}/complete`, { method: "POST" });
                                       if (res.ok) onOpenChange(false);
                                     } catch (err) {
                                       console.error("Failed to mark session complete:", err);
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
               )}
          </div>
        </div>
      </>
    );
  }
