// One Ask Copper answer, drawn as stations on a rail in the order they
// happened: the tools on offer, Copper's thinking, each tool call (what Copper
// sent and what came back), then the reply. Spec section 5.
import { lazy, Suspense, type ReactNode } from "react";
import {
  AlertTriangleIcon,
  BrainIcon,
  ListIcon,
  WrenchIcon,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { formatUsd } from "@/lib/copper/catalog";
import {
  TOOL_LABELS,
  type Progress,
  type ToolStep,
} from "@/lib/copper/assistant/progress";
import type {
  Availability,
  CostBreakdown,
  Prices,
  ProductList,
} from "@/lib/copper/assistant/tools";

// The markdown renderer is large, so load it only once there's a reply to show.
const MessageResponse = lazy(() =>
  import("@/components/ai-elements/message").then((m) => ({ default: m.MessageResponse })),
);

/** Renders the little markdown Gemini uses: **bold** and `code`. */
function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part, i) => {
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        return (
          <code key={i} className="font-mono not-italic">
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
}

/** "copper-home" → "Copper Home". */
function nameOf(id: unknown): string {
  return String(id)
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** "2026-11-14" → "Nov 14, 2026". */
function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Station({
  icon,
  node,
  label,
  children,
}: {
  icon: ReactNode;
  node: string;
  label?: string;
  children?: ReactNode;
}) {
  return (
    <div className="relative">
      <span
        className={cn(
          "ring-secondary absolute top-0 -left-8 flex size-6 items-center justify-center rounded-full text-white ring-4 [&_svg]:size-3.5",
          node,
        )}
      >
        {icon}
      </span>
      {label && (
        <p className="text-muted-foreground pt-1 text-[11px] font-semibold tracking-widest uppercase">
          {label}
        </p>
      )}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function ToolsStation({ used, useTools }: { used: Set<string>; useTools: boolean }) {
  const names = Object.keys(TOOL_LABELS);
  if (!useTools) {
    return (
      <Station
        icon={<ListIcon />}
        node="bg-chart-3"
        label="Tools given to Copper: none"
      >
        <div className="flex flex-wrap gap-1.5">
          {names.map((name) => (
            <span
              key={name}
              className="text-muted-foreground rounded-full border px-2 py-0.5 font-mono text-xs line-through opacity-60"
            >
              {name}
            </span>
          ))}
        </div>
        <p className="text-muted-foreground mt-1.5 text-xs">
          Copper has to answer from memory alone.
        </p>
      </Station>
    );
  }
  return (
    <Station icon={<ListIcon />} node="bg-primary" label="Tools Copper can use">
      <div className="flex flex-wrap gap-1.5">
        {names.map((name) => (
          <span
            key={name}
            className={cn(
              "rounded-full px-2 py-0.5 font-mono text-xs",
              used.has(name)
                ? "bg-accent font-bold text-white"
                : "bg-muted text-muted-foreground",
            )}
          >
            {name}
          </span>
        ))}
      </div>
    </Station>
  );
}

function ThinkingStation({ text, useTools }: { text: string; useTools: boolean }) {
  return (
    <Station
      icon={<BrainIcon />}
      node={useTools ? "bg-primary" : "bg-chart-3"}
      label="Copper is thinking"
    >
      <div
        data-testid="thinking"
        className="text-muted-foreground border-border border-l-2 pl-3 text-sm whitespace-pre-wrap italic"
      >
        {inline(text)}
      </div>
    </Station>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}

function SentInput({ step }: { step: ToolStep }) {
  if (step.name === "get_prices") return <p className="text-sm">Nothing, it just asked for the price list</p>;
  if (step.name === "get_products") return <p className="text-sm">Nothing, it just asked what Copper sells</p>;
  if (step.input === undefined) {
    return <p className="text-muted-foreground text-sm italic">filling in the details…</p>;
  }
  const input = step.input as Record<string, unknown>;
  if (step.name === "calculate_cost") {
    const products = Array.isArray(input.products) ? input.products : [];
    return (
      <div className="space-y-0.5">
        <Row label="Products">{products.length ? products.map(nameOf).join(", ") : "None"}</Row>
        <Row label="Plan">{nameOf(input.plan)}</Row>
        <Row label="Billing">{String(input.billing)}</Row>
        <Row label="Years">{String(input.years)}</Row>
      </div>
    );
  }
  if (step.name === "check_availability") {
    return (
      <div className="space-y-0.5">
        <Row label="Product">{nameOf(input.product)}</Row>
        <Row label="Color">{input.color ? String(input.color) : "Every color"}</Row>
      </div>
    );
  }
  return (
    <div className="space-y-0.5">
      {Object.entries(input).map(([key, value]) => (
        <Row key={key} label={key}>
          {String(value)}
        </Row>
      ))}
    </div>
  );
}

const STOCK_PILLS = {
  in_stock: "bg-accent text-white",
  low_stock: "bg-chart-4 text-foreground",
  backordered: "bg-chart-3 text-white",
};

function stockLabel(stock: keyof typeof STOCK_PILLS, restockDate: string | null) {
  if (stock === "in_stock") return "In stock";
  if (stock === "low_stock") return "Low stock";
  return restockDate ? `Back-ordered until ${formatDate(restockDate)}` : "Back-ordered";
}

function CameBack({ step }: { step: ToolStep }) {
  if (step.state === "calling") {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner className="size-3.5" /> the app is running the code…
      </p>
    );
  }
  if (step.state === "error") {
    return <p className="text-sm">{String(step.output)}</p>;
  }
  if (step.name === "calculate_cost") {
    const { lines, totalUsd } = step.output as CostBreakdown;
    return (
      <div className="space-y-1 text-sm">
        {lines.map((line, i) => (
          <div key={i} className="flex justify-between gap-3">
            <span>{line.item}</span>
            <span>{formatUsd(line.usd)}</span>
          </div>
        ))}
        <div className="border-border flex items-baseline justify-between border-t pt-1.5">
          <span className="font-semibold">Total</span>
          <span className="text-primary text-xl font-bold">{formatUsd(totalUsd)}</span>
        </div>
      </div>
    );
  }
  if (step.name === "get_products") {
    const { products } = step.output as ProductList;
    return (
      <div className="space-y-2.5 text-sm">
        {products.map((product) => (
          <div key={product.id}>
            <div className="flex justify-between gap-3 font-medium">
              <span>{product.name}</span>
              <span>{formatUsd(product.priceUsd)}</span>
            </div>
            <p className="text-muted-foreground text-xs">{product.type}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {product.colors.map((color) => (
                <span key={color} className="bg-accent rounded-full px-2 py-0.5 text-xs text-white">
                  {color}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (step.name === "get_prices") {
    const { products, plans } = step.output as Prices;
    return (
      <div className="space-y-1 text-sm">
        {products.map((product) => (
          <div key={product.id} className="flex justify-between gap-3">
            <span>{product.name}</span>
            <span>{formatUsd(product.priceUsd)}</span>
          </div>
        ))}
        {plans
          .filter((plan) => plan.monthlyUsd > 0 || plan.annualUsd > 0)
          .map((plan) => (
            <div key={plan.id} className="flex justify-between gap-3">
              <span>{plan.name}</span>
              <span>
                {formatUsd(plan.monthlyUsd)}/mo · {formatUsd(plan.annualUsd)}/yr
              </span>
            </div>
          ))}
      </div>
    );
  }
  if (step.name === "check_availability") {
    const result = step.output as Availability;
    if (result.status === "unavailable") return <p className="text-sm">{result.message}</p>;
    if (result.status === "not_a_color") {
      return (
        <p className="text-sm">
          {result.product} doesn&apos;t come in {result.color}. It comes in{" "}
          {result.colors.join(", ")}.
        </p>
      );
    }
    return (
      <div className="space-y-1 text-sm">
        {result.colors.map((entry) => (
          <div key={entry.color} className="flex items-center justify-between gap-3">
            <span>
              {result.product}, {entry.color}
            </span>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STOCK_PILLS[entry.stock])}>
              {stockLabel(entry.stock, entry.restockDate)}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(step.output, null, 2)}</pre>;
}

function ToolCard({ step, number }: { step: ToolStep; number: number }) {
  return (
    <Station
      icon={<WrenchIcon />}
      node="bg-accent"
      label={step.state === "calling" ? "Copper is calling a tool" : "Copper called a tool"}
    >
      <div
        data-testid="tool-call"
        data-tool={step.name}
        className="bg-card overflow-hidden rounded-lg border"
      >
        <div className="bg-accent flex flex-wrap items-center gap-2 px-3 py-1.5 text-white">
          <span className="font-mono text-sm font-bold">{step.name}()</span>
          <span className="rounded-full bg-white/20 px-1.5 text-[10px]">tool {number}</span>
          <span className="ml-auto text-xs">{TOOL_LABELS[step.name] ?? step.name}</span>
        </div>
        <div className="space-y-1.5 px-3 py-2">
          <p className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
            → What Copper sent
          </p>
          <SentInput step={step} />
        </div>
        <div className="bg-accent/10 space-y-1.5 border-t px-3 py-2">
          <p className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
            ← What came back
          </p>
          <CameBack step={step} />
        </div>
      </div>
    </Station>
  );
}

function statusText(progress: Progress | null, useTools: boolean): string {
  if (progress?.reply) return "Writing the answer…";
  if (!useTools) return "Answering from memory…";
  if (progress?.steps.length) return "Deciding what to do next…";
  return "Reading your question…";
}

export function AskCopperAnswer({
  progress,
  useTools,
}: {
  progress: Progress | null;
  useTools: boolean;
}) {
  const steps = progress?.steps ?? [];
  const working = !progress || progress.status === "working";
  const used = new Set(steps.filter((s) => s.type === "tool").map((s) => s.name));
  // Each tool call's number in this answer, worked out before the JSX.
  const toolNumbers = steps.map(
    (step, i) => steps.slice(0, i + 1).filter((s) => s.type === "tool").length,
  );

  return (
    <div className="space-y-3">
      <div className="relative space-y-4 pl-8">
        <span
          aria-hidden
          className={cn(
            "absolute top-2 bottom-2 left-[11px] w-0.5 rounded-full bg-gradient-to-b",
            useTools ? "from-primary via-accent to-accent" : "from-chart-3 to-chart-3",
          )}
        />
        <ToolsStation used={used} useTools={useTools} />
        {steps.map((step, i) =>
          step.type === "thinking" ? (
            <ThinkingStation key={i} text={step.text} useTools={useTools} />
          ) : (
            <ToolCard key={step.id} step={step} number={toolNumbers[i]} />
          ),
        )}
        {working && (
          <Station
            icon={
              <span className="flex gap-0.5">
                {[0, 1, 2].map((dot) => (
                  <span
                    key={dot}
                    className="size-1 animate-bounce rounded-full bg-white"
                    style={{ animationDelay: `${dot * 150}ms` }}
                  />
                ))}
              </span>
            }
            node={cn("animate-pulse", useTools ? "bg-primary" : "bg-chart-3")}
          >
            <p className="text-muted-foreground pt-0.5 text-sm">{statusText(progress, useTools)}</p>
          </Station>
        )}
      </div>

      {progress?.reply && (
        <div className="bg-card rounded-xl rounded-tl-sm border p-3 shadow-sm">
          <p className="text-primary mb-1 text-xs font-semibold">Copper</p>
          {!useTools && (
            <div className="border-chart-3 bg-chart-3/10 mb-2 rounded-md border p-2 text-xs">
              <p className="flex items-center gap-1.5">
                <AlertTriangleIcon className="text-chart-3 size-3.5" />
                <strong>Answered without tools: may be made up</strong>
              </p>
              <p className="text-muted-foreground mt-1">
                With tools off, Copper can&apos;t see today&apos;s prices or stock. The AI only has
                what it learned in training, so it fills the gaps with guesses that sound right.
                That&apos;s a hallucination.
              </p>
            </div>
          )}
          <Suspense fallback={<p className="text-sm whitespace-pre-wrap">{progress.reply}</p>}>
            <MessageResponse className="text-sm" isAnimating={working}>
              {progress.reply}
            </MessageResponse>
          </Suspense>
        </div>
      )}
    </div>
  );
}
