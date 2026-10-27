"use server";

// Module 2: the server action the Ask Copper chat calls. It streams the
// conversation to the model through callStream (lib/ai/call.ts), with or
// without the tools, and sends back each step as it happens, so the panel can
// show Copper thinking and using its tools. The contract is in
// specs/module-2/spec.md.
import { stepCountIs } from "ai";
import { callStream, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { createLive, type Live } from "@/lib/ai/live";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import type { Progress, Step, ToolStep } from "@/lib/copper/assistant/progress";
import { copperTools } from "@/lib/copper/assistant/tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AskCopperRequest = {
  messages: ChatMessage[];
  useTools: boolean;
};

export type AskCopperResult = { progress: Live<Progress> };

/** At most this many model steps (tool calls plus the reply) per question. */
const MAX_STEPS = 5;

const SORRY = "Sorry, I couldn't come up with an answer just now. Please try again.";

export async function askCopper(
  request: AskCopperRequest,
): Promise<AskCopperResult> {
  const { live, update, done } = createLive<Progress>();
  // Read the stream in the background, so the panel sees the first update
  // straight away instead of waiting for the whole answer.
  void streamAnswer(request, update, done);
  return { progress: live };
}

async function streamAnswer(
  { messages, useTools }: AskCopperRequest,
  update: (value: Progress) => void,
  done: (value: Progress) => void,
) {
  const steps: Step[] = [];
  let reply = "";
  // Each update is a fresh copy (the steps array and every step in it), so
  // earlier updates never change underneath whoever is holding them.
  const snapshot = (status: Progress["status"]): Progress => ({
    steps: steps.map((step) => ({ ...step })),
    reply,
    status,
  });
  const toolStep = (id: string) =>
    steps.find((step): step is ToolStep => step.type === "tool" && step.id === id);

  try {
    // With tools off, the model gets just the conversation: no instructions
    // and no tools, so nothing tells it to check anything.
    const result = callStream(
      { module: 2, feature: "ask-copper" },
      useTools
        ? {
            instructions: COPPER_INSTRUCTIONS,
            messages,
            tools: copperTools,
            stopWhen: stepCountIs(MAX_STEPS),
            providerOptions: THOUGHT_SUMMARIES,
          }
        : { messages, providerOptions: THOUGHT_SUMMARIES },
    );

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "reasoning-delta": {
          const last = steps.at(-1);
          if (last?.type === "thinking") last.text += part.text;
          else steps.push({ type: "thinking", text: part.text });
          break;
        }
        case "tool-input-start":
          // The name arrives before the input, so show the tool right away.
          steps.push({ type: "tool", id: part.id, name: part.toolName, state: "calling" });
          break;
        case "tool-call": {
          const step = toolStep(part.toolCallId);
          if (step) step.input = part.input;
          else
            steps.push({
              type: "tool",
              id: part.toolCallId,
              name: part.toolName,
              state: "calling",
              input: part.input,
            });
          break;
        }
        case "tool-result": {
          const step = toolStep(part.toolCallId);
          if (step) {
            step.output = part.output;
            step.state = "done";
          }
          break;
        }
        case "tool-error": {
          const step = toolStep(part.toolCallId);
          if (step) {
            step.output = part.error instanceof Error ? part.error.message : String(part.error);
            step.state = "error";
          }
          break;
        }
        case "text-delta":
          reply += part.text;
          break;
        case "error":
          throw part.error;
        default:
          continue;
      }
      update(snapshot("working"));
    }

    if (!reply.trim()) reply = SORRY;
    done(snapshot("done"));
  } catch (error) {
    console.error("[ask-copper]", error instanceof Error ? error.message : error);
    if (!reply.trim()) reply = SORRY;
    done(snapshot("error"));
  }
}
