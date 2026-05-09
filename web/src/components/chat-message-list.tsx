import {
  forwardRef,
  type ReactNode,
  useImperativeHandle,
  useEffect,
  useRef,
  useState,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { ChevronDown } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolCall {
  tool: string;
  callID: string;
  status: "completed" | "running" | "failed";
  input: Record<string, unknown>;
  output: string;
}

export interface Message {
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

export interface ChatMessageListProps {
  /** All visible messages. */
  messages: Message[];
  /** Render callback for each message – decoupled from MessageRow. */
  renderMessage: (
    msg: Message,
    prevMsg: Message | undefined,
    nextMsg: Message | undefined,
    isLast: boolean,
  ) => ReactNode;
}

export interface ChatMessageListHandle {
  scrollToBottom: () => void;
  scrollToIndex: (index: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ChatMessageList = forwardRef<ChatMessageListHandle, ChatMessageListProps>(
  function ChatMessageList({ messages, renderMessage }, ref) {
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const [isAtBottom, setIsAtBottom] = useState(true);
    const scrolledToBottomRef = useRef(false);

    // Scroll to the very bottom after mount / when messages first appear.
    // initialTopMostItemIndex only aligns the TOP of the item, so large last
    // messages can still leave us scrolled up. This effect forces a scroll to
    // the END of the last item.
    useEffect(() => {
      if (messages.length > 0 && !scrolledToBottomRef.current) {
        scrolledToBottomRef.current = true;
        // Use requestAnimationFrame to wait for Virtuoso to measure items
        requestAnimationFrame(() => {
          virtuosoRef.current?.scrollToIndex({
            index: messages.length - 1,
            align: "end",
          });
        });
      }
    }, [messages.length]);

    // Expose imperative methods so the parent can scroll programmatically.
    useImperativeHandle(
      ref,
      () => ({
        scrollToBottom: () => {
          virtuosoRef.current?.scrollToIndex({
            index: messages.length - 1,
            behavior: "smooth",
            align: "end",
          });
        },
        scrollToIndex: (index: number) => {
          virtuosoRef.current?.scrollToIndex({ index });
        },
      }),
      [messages.length],
    );

    return (
      <div className="relative flex-1 min-h-0">
        <Virtuoso
          ref={virtuosoRef}
          data={messages}
          initialTopMostItemIndex={Math.max(0, messages.length - 1)}
          followOutput={(atBottom) => (atBottom ? "smooth" : false)}
          atBottomStateChange={setIsAtBottom}
          overscan={400}
          itemContent={(index, msg) => {
            const prevMsg = index > 0 ? messages[index - 1] : undefined;
            const nextMsg = index < messages.length - 1 ? messages[index + 1] : undefined;
            const isLast = index === messages.length - 1;
            return renderMessage(msg, prevMsg, nextMsg, isLast);
          }}
          className="flex-1"
        />
        {/* Scroll-to-bottom button — rendered OUTSIDE the scroll container */}
        {!isAtBottom && (
          <div className="absolute bottom-2 right-4 z-10">
            <button
              type="button"
              onClick={() => {
                virtuosoRef.current?.scrollToIndex({
                  index: messages.length - 1,
                  behavior: "smooth",
                  align: "end",
                });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/90 border shadow-md text-xs text-muted-foreground hover:text-foreground hover:bg-background transition-colors backdrop-blur-sm"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              Scroll to bottom
            </button>
          </div>
        )}
      </div>
    );
  },
);
