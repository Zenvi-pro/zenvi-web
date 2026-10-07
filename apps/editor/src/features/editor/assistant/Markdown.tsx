import { Fragment, type ReactNode } from "react";

/**
 * Small, safe Markdown for Assistant replies: paragraphs, **bold**, *italic*,
 * `code`, fenced code blocks, lists and http(s) links. Renders React nodes,
 * never HTML strings.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyBase}-${i++}`;
    if (match[1]) out.push(<code key={key} className="rounded-[4px] bg-white/[0.08] px-1 py-px font-mono text-[12px] text-fg">{token.slice(1, -1)}</code>);
    else if (match[2]) out.push(<strong key={key} className="font-semibold text-fg">{token.slice(2, -2)}</strong>);
    else if (match[3]) out.push(<em key={key}>{token.slice(1, -1)}</em>);
    else if (match[4]) {
      const label = token.slice(1, token.indexOf("]("));
      out.push(
        <a key={key} href={match[5]} target="_blank" rel="noopener noreferrer" className="text-accent-hover underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
          {label}
        </a>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i++]!);
      i += 1;
      blocks.push(
        <pre key={key++} className="overflow-x-auto rounded-md bg-black/50 px-3 py-2 font-mono text-[12px] leading-relaxed text-fg-muted">
          {code.join("\n")}
        </pre>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key++} className={ordered ? "list-decimal space-y-0.5 pl-5" : "list-disc space-y-0.5 pl-5"}>
          {items.map((item, n) => (
            <li key={n}>{inline(item, `${key}-${n}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (/^#{1,4}\s/.test(line)) {
      blocks.push(
        <p key={key++} className="font-semibold text-fg">
          {inline(line.replace(/^#{1,4}\s/, ""), `h${key}`)}
        </p>,
      );
      i += 1;
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !lines[i]!.startsWith("```") && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) para.push(lines[i++]!);
    blocks.push(
      <p key={key++}>
        {para.map((p, n) => (
          <Fragment key={n}>
            {n > 0 ? <br /> : null}
            {inline(p, `${key}-${n}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="space-y-2">{blocks}</div>;
}
