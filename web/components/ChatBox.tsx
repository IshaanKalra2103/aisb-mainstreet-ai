"use client";
import { useMemo, useState } from "react";
import {
  AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive,
  useAuiState, useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike,
} from "@assistant-ui/react";
import type { Message } from "@/lib/types";
import { ApiError } from "@/lib/api";

const FRIENDLY_ERROR = "We could not reach our agent just now. Please try again in a minute.";

function toThreadMessage(m: Message, i: number): ThreadMessageLike {
  return {
    id: `m${i}`,
    role: m.role === "owner" ? "user" : "assistant",
    content: [{ type: "text", text: m.text }],
    createdAt: new Date(m.at || Date.now()),
    ...(m.role === "owner" ? {} : { status: { type: "complete", reason: "stop" } as const }),
  };
}

function Bubble() {
  const role = useAuiState((s) => s.message.role);
  const mine = role === "user";
  const hasText = useAuiState((s) => s.message.content.some((c) => c.type === "text" && c.text.length > 0));
  if (!hasText) return null; // the runtime adds an empty placeholder while a reply is pending; the typing dots cover it
  return (
    <MessagePrimitive.Root className={`chat-row ${mine ? "chat-row-me" : "chat-row-them"}`}>
      <div className={`chat-bubble ${mine ? "chat-bubble-me" : "chat-bubble-them"}`}>
        <span className="sr-only">{mine ? "You: " : "MainStreet: "}</span>
        <MessagePrimitive.Parts components={{ Text: ({ text }) => <span className="whitespace-pre-line">{text}</span> }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function Typing() {
  return (
    <div className="chat-row chat-row-them" role="status" aria-label="MainStreet is writing a reply">
      <div className="chat-bubble chat-bubble-them chat-typing" aria-hidden>
        <i /><i /><i />
      </div>
    </div>
  );
}

export default function ChatBox({
  messages, suggestions, onSend, disabled, running,
}: {
  messages: Message[];
  suggestions: { label: string; text: string }[];
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
  running?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = pending || !!running;
  const thread = useMemo(() => messages.map(toThreadMessage), [messages]);

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: thread,
    isRunning: busy,
    convertMessage: (m) => m,
    onNew: async (msg: AppendMessage) => {
      const text = msg.content.map((p) => (p.type === "text" ? p.text : "")).join("").trim();
      if (!text || pending) return;
      setPending(true); setError("");
      try {
        await onSend(text);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : FRIENDLY_ERROR);
      } finally { setPending(false); }
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="chat">
        <ThreadPrimitive.Viewport className="chat-viewport" role="log" aria-label="Conversation" aria-live="polite">
          <div className="chat-thread">
            <ThreadPrimitive.Messages>{() => <Bubble />}</ThreadPrimitive.Messages>
            {busy && <Typing />}
          </div>
        </ThreadPrimitive.Viewport>

        {error && <p role="alert" className="chat-error">{error}</p>}

        {!busy && suggestions.length > 0 && (
          <div className="chat-chips">
            {suggestions.map((s) => (
              <ThreadPrimitive.Suggestion key={s.label} prompt={s.text} send className="chat-chip" disabled={disabled}>
                {s.label}
              </ThreadPrimitive.Suggestion>
            ))}
          </div>
        )}

        <ComposerPrimitive.Root className="chat-composer">
          <ComposerPrimitive.Input
            aria-label="Ask a follow-up question"
            placeholder="Ask a follow-up question"
            rows={1}
            maxRows={5}
            disabled={disabled}
            className="chat-input"
          />
          <ComposerPrimitive.Send className="chat-send" aria-label="Send" disabled={disabled}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
