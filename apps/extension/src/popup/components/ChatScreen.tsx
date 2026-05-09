import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Send, X } from "lucide-react";
import { EvziStatusStripe } from "./EvziEyeLogo";
import { AnimatedEye } from "./AnimatedEye";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createChatMessage, EVZI_CHAT_PLACEHOLDER_REPLY, type ChatMessage } from "@/popup/chat/types";

/** `size` prop is SVG width; height = size × 36/40. Target ~80px visual height. */
const EMPTY_STATE_EYE_SIZE = Math.round((80 * 40) / 36);

const TEXTAREA_MAX_PX = 160;
const TEXTAREA_MIN_PX = 36;

export interface ChatScreenProps {
  onBack: () => void;
  onClose: () => void;
  /** Initial rows (e.g. empty state vs demo conversation). */
  initialMessages?: ChatMessage[];
  /**
   * Send the full thread (including the user's latest message) to the agent
   * and resolve with the assistant's reply text. When omitted (preview-only
   * mode), the chat falls back to a canned placeholder so the design can be
   * exercised without a backend.
   */
  sendMessage?: (messages: ChatMessage[]) => Promise<string>;
  className?: string;
}

export function ChatScreen({ onBack, onClose, initialMessages, sendMessage, className }: ChatScreenProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessages?.length ? [...initialMessages] : []
  );
  const [draft, setDraft] = useState("");
  const [pendingAssistant, setPendingAssistant] = useState(false);
  const bottomRef = useRef<HTMLLIElement>(null);
  const placeholderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    return () => {
      if (placeholderTimerRef.current) clearTimeout(placeholderTimerRef.current);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingAssistant]);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(Math.max(el.scrollHeight, TEXTAREA_MIN_PX), TEXTAREA_MAX_PX);
    el.style.height = `${next}px`;
  }, []);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [draft, resizeTextarea]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || pendingAssistant) return;

    const userMessage = createChatMessage("user", text);
    setDraft("");
    setMessages((prev) => [...prev, userMessage]);
    setPendingAssistant(true);

    if (sendMessage) {
      // Real agent path. Build the thread from the most recent state at
      // dispatch time so it always includes the user message we just appended.
      // We use messages + userMessage rather than a setMessages-callback
      // synthesis to keep the closure simple.
      sendMessage([...messages, userMessage])
        .then((reply) => {
          setMessages((curr) => [...curr, createChatMessage("assistant", reply)]);
        })
        .catch(() => {
          setMessages((curr) => [...curr, createChatMessage("assistant", EVZI_CHAT_PLACEHOLDER_REPLY)]);
        })
        .finally(() => {
          setPendingAssistant(false);
        });
      return;
    }

    // No backend wired (preview mode) — fall back to the canned placeholder.
    placeholderTimerRef.current = setTimeout(() => {
      setMessages((prev) => [...prev, createChatMessage("assistant", EVZI_CHAT_PLACEHOLDER_REPLY)]);
      setPendingAssistant(false);
      placeholderTimerRef.current = null;
    }, 450);
  }, [draft, pendingAssistant, sendMessage, messages]);

  const empty = messages.length === 0 && !pendingAssistant;

  return (
    <section
      className={cn(
        "evzi-popup-surface shadow-popup flex h-[min(85vh,640px)] max-h-[min(85vh,640px)] w-full max-w-[420px] flex-col overflow-hidden",
        className
      )}
    >
      <header className="flex shrink-0 items-center justify-between px-4 py-3">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-foreground/80" onClick={onBack} aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-foreground/70" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </header>

      <EvziStatusStripe status="blue" className="shrink-0" />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {empty ? (
          <div className="flex flex-col px-6 py-4">
            <div className="flex h-20 items-start pt-2">
              <AnimatedEye size={EMPTY_STATE_EYE_SIZE} />
            </div>
            <h1 className="font-heading mt-12 text-2xl font-bold leading-8 tracking-tight text-foreground">Need a second opinion?</h1>
            <p className="mt-2 text-sm leading-5 text-neutral-800">
              Ask about a transaction, permissions, contract activity, or something that doesn’t feel right.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-5 px-4 py-4">
            {messages.map((m) =>
              m.role === "user" ? (
                <li key={m.id} className="flex justify-end">
                  <div className="max-w-[min(100%,280px)] whitespace-pre-line rounded-lg bg-muted px-3 py-2 text-sm leading-5 text-foreground">
                    {m.content}
                  </div>
                </li>
              ) : (
                <li key={m.id} className="flex flex-col gap-2">
                  <div className="shrink-0">
                    <AnimatedEye size={36} />
                  </div>
                  <p className="whitespace-pre-line text-sm leading-5 text-foreground">{m.content}</p>
                </li>
              )
            )}
            {pendingAssistant ? (
              <li className="flex flex-col gap-2">
                <div className="shrink-0">
                  <AnimatedEye size={36} />
                </div>
                <p className="text-sm text-muted-foreground">…</p>
              </li>
            ) : null}
            <li ref={bottomRef} className="h-px shrink-0 list-none scroll-mt-4" aria-hidden />
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-card px-3 py-2">
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type..."
            rows={1}
            className="min-h-9 max-h-40 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0 md:text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={pendingAssistant}
            aria-label="Message"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mb-0.5 h-9 w-9 shrink-0 text-foreground hover:bg-muted"
            onClick={send}
            disabled={pendingAssistant || !draft.trim()}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}
