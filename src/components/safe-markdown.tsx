"use client";

import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Inline } from "@/lib/markdown";

function renderInline(nodes: Inline[], keyPrefix: string): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (n.t) {
      case "text":
        return <Fragment key={key}>{n.v}</Fragment>;
      case "code":
        return <code key={key}>{n.v}</code>;
      case "br":
        return <br key={key} />;
      case "strong":
        return <strong key={key}>{renderInline(n.c, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(n.c, key)}</em>;
    }
  });
}

/** Renders the safe Markdown subset from lib/markdown as React elements (no raw HTML). */
export function SafeMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className={`md ${className ?? ""}`}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        if (b.t === "p") return <p key={key}>{renderInline(b.c, key)}</p>;
        const items = b.items.map((it, j) => <li key={`${key}-${j}`}>{renderInline(it, `${key}-${j}`)}</li>);
        return b.t === "ul" ? (
          <ul key={key}>{items}</ul>
        ) : (
          <ol key={key} start={b.start}>
            {items}
          </ol>
        );
      })}
    </div>
  );
}
