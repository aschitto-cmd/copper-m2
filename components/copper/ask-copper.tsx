"use client";

// Module 2: Ask Copper, the floating shopping chat. Tools on and tools off are
// two separate conversations, each sent with only its own history, so the
// tools-off model can't copy an answer the tools worked out. Spec section 4.
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowUpIcon, MessageCircleIcon } from "lucide-react";
import { AskCopperAnswer } from "@/components/copper/ask-copper-answer";
import { SetupRequired } from "@/components/setup-required";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { readLive } from "@/lib/ai/live";
import { askCopper, type ChatMessage } from "@/lib/copper/assistant/ask";
import type { Progress } from "@/lib/copper/assistant/progress";

const STARTERS = [
  "How much is Copper Home with Copper Plus, paid yearly, for 2 years?",
  "Is Copper Notes in Night Sky in stock?",
  "Is Copper Plus cheaper monthly or yearly?",
];

type Turn = { question: string; progress: Progress | null };
type ChatKey = "on" | "off";

const SORRY = "Sorry, something went wrong. Please try again.";

export function AskCopper({ aiConfigured }: { aiConfigured: boolean }) {
  const [open, setOpen] = useState(
    () => typeof window !== "undefined" && window.location.hash === "#ask",
  );
  const [useTools, setUseTools] = useState(true);
  const [chats, setChats] = useState<Record<ChatKey, Turn[]>>({ on: [], off: [] });
  const [busy, setBusy] = useState<Record<ChatKey, boolean>>({ on: false, off: false });
  const [draft, setDraft] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  const key: ChatKey = useTools ? "on" : "off";
  const turns = chats[key];

  // Open from /#ask, and from any link to #ask. Clicking the link again once
  // the address already ends in #ask fires no hashchange, so listen for
  // clicks too.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === "#ask") setOpen(true);
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href$='#ask']");
      if (link) setOpen(true);
    };
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick);
    };
  }, []);

  // Keep the newest step in view.
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [chats, useTools]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy[key]) return;
    const chat = key;
    const index = turns.length;
    // Only this chat's history: each question and Copper's finished reply.
    const messages: ChatMessage[] = turns.flatMap((turn): ChatMessage[] => [
      { role: "user", content: turn.question },
      ...(turn.progress?.reply
        ? [{ role: "assistant" as const, content: turn.progress.reply }]
        : []),
    ]);
    messages.push({ role: "user", content: text });

    const setProgress = (progress: Progress) =>
      setChats((prev) => ({
        ...prev,
        [chat]: prev[chat].map((turn, i) => (i === index ? { ...turn, progress } : turn)),
      }));

    setDraft("");
    setBusy((prev) => ({ ...prev, [chat]: true }));
    setChats((prev) => ({ ...prev, [chat]: [...prev[chat], { question: text, progress: null }] }));
    try {
      const { progress } = await askCopper({ messages, useTools: chat === "on" });
      for await (const update of readLive(progress)) setProgress(update);
    } catch {
      setProgress({ steps: [], reply: SORRY, status: "error" });
    } finally {
      setBusy((prev) => ({ ...prev, [chat]: false }));
    }
  }

  return (
    <>
      <Button
        data-testid="ask-copper-launcher"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 h-12 rounded-full px-5 shadow-lg"
      >
        <MessageCircleIcon />
        Ask Copper
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          data-testid="ask-copper"
          side="right"
          className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md [&>[data-slot=sheet-close]]:text-white"
        >
          <div className="bg-chart-5 text-background">
            <div className="flex items-center gap-3 px-4 py-3 pr-12">
              <span className="bg-primary flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full">
                <Image
                  src="/assets/brand/copper-mascot.png"
                  alt="Copper, the Copper State Labs mascot"
                  width={40}
                  height={40}
                />
              </span>
              <div>
                <SheetTitle className="text-background text-base">Ask Copper</SheetTitle>
                <SheetDescription className="text-background/70 text-xs">
                  Prices, totals and stock, checked with tools.
                </SheetDescription>
              </div>
            </div>
            {aiConfigured && (
              <div className="flex items-center gap-3 bg-white/10 px-4 py-2">
                <span className="text-sm font-medium">Use tools</span>
                <span className="text-background/70 text-xs">
                  {useTools ? "Checks every answer" : "Model guesses alone"}
                </span>
                <Switch
                  aria-label="Use tools"
                  checked={useTools}
                  onCheckedChange={setUseTools}
                  className="ml-auto"
                />
              </div>
            )}
          </div>

          {aiConfigured ? (
            <>
              <div ref={bodyRef} className="bg-secondary flex-1 space-y-5 overflow-y-auto p-4">
                {turns.map((turn, i) => (
                  <div key={i} className="space-y-3">
                    <p className="bg-primary text-primary-foreground ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm px-3 py-2 text-sm">
                      {turn.question}
                    </p>
                    <AskCopperAnswer progress={turn.progress} useTools={useTools} />
                  </div>
                ))}
                {!busy[key] && (
                  <div className="space-y-2">
                    {turns.length === 0 && (
                      <p className="text-muted-foreground text-sm">
                        Ask about prices, totals or stock. Try one of these:
                      </p>
                    )}
                    {STARTERS.map((starter) => (
                      <Button
                        key={starter}
                        variant="outline"
                        onClick={() => ask(starter)}
                        className="bg-card h-auto w-full justify-start text-left whitespace-normal"
                      >
                        {starter}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void ask(draft);
                }}
                className="bg-background flex items-center gap-2 border-t p-3"
              >
                <Input
                  aria-label="Your question"
                  placeholder="Ask about prices, totals or stock…"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="rounded-full"
                />
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Send"
                  disabled={busy[key]}
                  className="shrink-0 rounded-full"
                >
                  <ArrowUpIcon />
                </Button>
              </form>
            </>
          ) : (
            <div className="bg-secondary flex-1 overflow-y-auto p-4">
              <SetupRequired service="ai" />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
