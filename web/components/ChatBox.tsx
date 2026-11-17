"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive,
  groupPartByType, useAuiState, useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike,
} from "@assistant-ui/react";
import {
  ArrowUp, Check, Clapperboard, Hand, ListChecks, RefreshCw, Rocket, Scale, Store, TriangleAlert,
} from "lucide-react";
import {
  ReasoningContent, ReasoningRoot, ReasoningText, ReasoningTrigger,
} from "@/components/assistant-ui/elements/reasoning.aui";
import MascotLogo from "@/components/MascotLogo";
import type { Message, TurnEvent } from "@/lib/types";
import { ApiError } from "@/lib/api";

const FRIENDLY_ERROR = "We could not reach our agent just now. Please try again in a minute.";
const MASCOT = "/brand/mascot.webp";

type Part = Exclude<ThreadMessageLike["content"], string>[number];

/** What each saved record kind looks like as one of the agent's tool rows. */
const TOOLS: Record<string, { label: string; icon: ReactNode }> = {
  profile: { label: "Saved your shop profile", icon: <Store /> },
  needs: { label: "Updated your jobs", icon: <ListChecks /> },
  compare: { label: "Compared tools", icon: <Scale /> },
  preview: { label: "Made a preview", icon: <Clapperboard /> },
  approval: { label: "Asked for your OK", icon: <Hand /> },
  setup: { label: "Updated your setup", icon: <Rocket /> },
};
const toolFor = (kind: string) => TOOLS[kind] ?? { label: "Updated your page", icon: <RefreshCw /> };

function toThreadMessage(m: Message, i: number): ThreadMessageLike {
  return {
    id: `m${i}`,
    role: m.role === "owner" ? "user" : "assistant",
    content: [{ type: "text", text: m.text }],
    createdAt: new Date(m.at || Date.now()),
    ...(m.role === "owner" ? {} : { status: { type: "complete", reason: "stop" } as const }),
  };
}

/**
 * The running turn's events as message parts: each step the agent reaches is a reasoning part (once, in order) and each
 * record it saves is a tool call, so the thread shows the work in one disclosure instead of a second log box.
 */
function traceParts(events: TurnEvent[]): Part[] {
  const parts: Part[] = [];
  const seenSteps = new Set<string>();
  const seenKinds = new Set<string>();
  events.forEach((e, i) => {
    if (e.type === "queued" || e.type === "status") {
      const text = e.type === "queued"
        ? (e.position > 0 ? `You are number ${e.position} in line. We will start soon.` : "Starting now")
        : e.text;
      if (seenSteps.has(text)) return;
      seenSteps.add(text);
      parts.push({ type: "reasoning", id: `step-${i}`, text });
    } else if (e.type === "files") {
      for (const kind of e.kinds) {
        if (seenKinds.has(kind)) continue;
        seenKinds.add(kind);
        parts.push({ type: "tool-call", toolCallId: `save-${kind}`, toolName: `save_${kind}`, args: { kind }, result: { ok: true } });
      }
    } else if (e.type === "error") {
      parts.push({ type: "tool-call", toolCallId: `error-${i}`, toolName: "error", args: { message: e.message }, result: { message: e.message }, isError: true });
    }
  });
  return parts;
}

/** The thread the runtime shows: the saved messages, the owner's text until the server has it, and the turn's trace. */
type Sent = { text: string; before: number };
const ownerCount = (messages: Message[], text: string) => messages.filter((m) => m.role === "owner" && m.text.trim() === text).length;

function buildThread(messages: Message[], events: TurnEvent[], running: boolean, sent: Sent | null): ThreadMessageLike[] {
  const thread = messages.map(toThreadMessage);
  if (sent && ownerCount(messages, sent.text) <= sent.before) {
    thread.push({ id: "sent", role: "user", content: [{ type: "text", text: sent.text }] });
  }
  const parts = traceParts(events);
  if (parts.length === 0) return thread;
  const trace: ThreadMessageLike = {
    id: "trace",
    role: "assistant",
    content: parts,
    status: running ? { type: "running" } : { type: "complete", reason: "stop" },
  };
  // A finished turn's trace sits above its reply: right after the owner's last message, when a reply follows it.
  const lastOwner = thread.map((m) => m.role).lastIndexOf("user");
  const finished = !running && events.some((e) => e.type === "done") && lastOwner >= 0 && lastOwner < thread.length - 1;
  if (finished) thread.splice(lastOwner + 1, 0, trace);
  else thread.push(trace);
  return thread;
}

/** Seconds since the disclosure started watching a running turn (a liveness hint, not a claim about the whole turn). */
function useElapsed(running: boolean) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  return secs;
}

function Avatar({ show }: { show: boolean }) {
  return (
    <span className="chat-avatar" aria-hidden>
      {show && <img src={MASCOT} alt="" width={32} height={32} />}
    </span>
  );
}

function Steps({ count, children }: { count: number; children: ReactNode }) {
  const running = useAuiState((s) => s.message.status?.type === "running");
  const failed = useAuiState((s) => s.message.parts.some((p) => p.type === "tool-call" && p.toolName === "error"));
  const secs = useElapsed(running);
  const label = running
    ? <>Working on it{secs > 0 && <span className="chat-steps-time"> · {secs}s</span>}</>
    : failed ? "Stopped" : `Done · ${count} step${count === 1 ? "" : "s"}`;
  return (
    <ReasoningRoot variant="ghost" streaming={running} className="chat-steps">
      <ReasoningTrigger
        active={running}
        label={label}
        className="chat-steps-trigger"
        icon={<span className={`chat-steps-icon ${running ? "is-running" : failed ? "is-failed" : "is-done"}`} aria-hidden>
          {running ? <i /> : failed ? <TriangleAlert /> : <Check />}
        </span>}
      />
      <ReasoningContent aria-busy={running}>
        <ReasoningText className="chat-steps-text">
          <ol className="chat-steplist">{children}</ol>
        </ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  );
}

function StepLine({ text, current }: { text: string; current: boolean }) {
  return (
    <li className="chat-step" data-current={current || undefined}>
      <span className="chat-step-dot" aria-hidden />
      <span>{text}</span>
    </li>
  );
}

function ToolRow({ name, message }: { name: string; message?: string }) {
  if (name === "error") {
    return (
      <li className="chat-step chat-tool is-error">
        <span className="chat-tool-icon" aria-hidden><TriangleAlert /></span>
        <span>{message || "Something went wrong"}</span>
      </li>
    );
  }
  const tool = toolFor(name.replace(/^save_/, ""));
  return (
    <li className="chat-step chat-tool">
      <span className="chat-tool-icon" aria-hidden>{tool.icon}</span>
      <span>{tool.label}</span>
      <Check className="chat-tool-check" aria-label="done" />
    </li>
  );
}

const GROUP_BY = groupPartByType({ reasoning: ["group-steps"], "tool-call": ["group-steps"] });

function Paragraphs({ text }: { text: string }) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return <>{paras.map((p, i) => <p key={i} className="chat-para">{p}</p>)}</>;
}

/** Things shown under an agent message, keyed by its index in `messages` (a preview video under "your preview is ready"). */
const Extras = createContext<Record<number, ReactNode>>({});

function AgentMessage() {
  const extras = useContext(Extras);
  const extra = useAuiState((s) => { const m = /^m(\d+)$/.exec(s.message.id ?? ""); return m ? Number(m[1]) : -1; });
  const first = useAuiState((s) => s.message.index === 0 || s.thread.messages[s.message.index - 1]?.role !== "assistant");
  const running = useAuiState((s) => s.message.status?.type === "running");
  const lastIndex = useAuiState((s) => s.message.parts.length - 1);
  return (
    <MessagePrimitive.Root className="chat-row chat-row-them">
      <Avatar show={first} />
      <div className="chat-agent">
        <span className="sr-only">MainStreet: </span>
        <MessagePrimitive.GroupedParts groupBy={GROUP_BY} indicator="never">
          {({ part, children }) => {
            switch (part.type) {
              case "group-steps":
                return <Steps count={part.indices.length}>{children}</Steps>;
              case "reasoning":
                return <StepLine text={part.text} current={running && part.status.type === "running"} />;
              case "tool-call":
                return <ToolRow name={part.toolName} message={(part.args as { message?: string } | undefined)?.message} />;
              case "text":
                return part.text ? <div className="chat-text"><Paragraphs text={part.text} /></div> : <></>;
              default:
                return <></>;
            }
          }}
        </MessagePrimitive.GroupedParts>
        {running && lastIndex < 0 && <Dots />}
        {extras[extra] && <div className="mt-3">{extras[extra]}</div>}
      </div>
    </MessagePrimitive.Root>
  );
}

function OwnerMessage() {
  return (
    <MessagePrimitive.Root className="chat-row chat-row-me">
      <div className="chat-bubble-me">
        <span className="sr-only">You: </span>
        <MessagePrimitive.Parts components={{ Text: ({ text }) => <span className="whitespace-pre-line">{text}</span> }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function Bubble() {
  const role = useAuiState((s) => s.message.role);
  const hasContent = useAuiState((s) => s.message.content.some((c) => (c.type === "text" && c.text.length > 0) || c.type !== "text"));
  if (!hasContent) return null; // the runtime adds an empty placeholder while a reply is pending; the typing row covers it
  return role === "user" ? <OwnerMessage /> : <AgentMessage />;
}

function Dots() {
  return <span className="chat-dots" aria-hidden><i /><i /><i /></span>;
}

function Typing() {
  return (
    <div className="chat-row chat-row-them" role="status" aria-label="MainStreet is writing a reply">
      <Avatar show />
      <div className="chat-agent"><Dots /></div>
    </div>
  );
}

function Welcome() {
  return (
    <div className="chat-welcome">
      <MascotLogo size={104} wordmark={false} play="intro" className="chat-welcome-mascot" />
      <h3 className="chat-welcome-title">Hi, I&rsquo;m MainStreet.</h3>
      <p className="chat-welcome-sub">Ask about any job on your page, or tell me what I got wrong.</p>
    </div>
  );
}

export default function ChatBox({
  messages, events = [], suggestions, onSend, disabled, running, extras = {},
}: {
  messages: Message[];
  /** Shown under the agent message at that index in `messages`. */
  extras?: Record<number, ReactNode>;
  /** The followed turn's events; they become the steps and tool rows above the reply. */
  events?: TurnEvent[];
  suggestions: { label: string; text: string }[];
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
  running?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [error, setError] = useState("");
  const busy = pending || !!running;
  const thread = useMemo(() => buildThread(messages, events, !!running, sent), [messages, events, running, sent]);
  const tracing = events.length > 0 && !!running;

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: thread,
    isRunning: busy,
    convertMessage: (m) => m,
    onNew: async (msg: AppendMessage) => {
      const text = msg.content.map((p) => (p.type === "text" ? p.text : "")).join("").trim();
      if (!text || pending) return;
      setPending(true); setError(""); setSent({ text, before: ownerCount(messages, text) });
      try {
        await onSend(text);
      } catch (e) {
        setSent(null);
        setError(e instanceof ApiError ? e.message : FRIENDLY_ERROR);
      } finally { setPending(false); }
    },
  });

  return (
    <Extras.Provider value={extras}>
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="chat">
        <ThreadPrimitive.Viewport className="chat-viewport" role="log" aria-label="Conversation" aria-live="polite">
          <div className="chat-thread">
            {thread.length === 0 && !busy && <Welcome />}
            <ThreadPrimitive.Messages>{() => <Bubble />}</ThreadPrimitive.Messages>
            {busy && !tracing && <Typing />}
          </div>
        </ThreadPrimitive.Viewport>

        <div className="chat-dock">
          {error && <p role="alert" className="chat-error">{error}</p>}

          {!busy && suggestions.length > 0 && (
            <div className="chat-chips" aria-label="Suggestions">
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
              placeholder={busy ? "MainStreet is working on it…" : "Ask a follow-up question"}
              rows={1}
              maxRows={5}
              disabled={disabled}
              className="chat-input"
            />
            <ComposerPrimitive.Send className="chat-send" aria-label="Send" disabled={disabled}>
              <ArrowUp aria-hidden />
            </ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
        </div>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
    </Extras.Provider>
  );
}
