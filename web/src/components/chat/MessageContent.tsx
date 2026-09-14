import { Fragment, type ReactNode } from "react";

function normalizeStructuredLineBreaks(value: string) {
  return value.replace(
    /\s+(?=(?:[-•]\s*)?(?:\*\*)?(?:Frontend|Backend|Kompatibilitas|Toko|Versi(?:\s+(?:frontend|backend|FE|BE))?)\s*:\s*)/gi,
    "\n",
  );
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export function MessageContent({ content }: { content: string }) {
  const lines = normalizeStructuredLineBreaks(String(content || "").replace(/\r\n/g, "\n")).split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];

  function flushList() {
    if (!list.length) return;
    blocks.push(
      <ul className="bubble-list" key={`list-${blocks.length}`}>
        {list.map((item, index) => <li key={index}>{renderInline(item)}</li>)}
      </ul>
    );
    list = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    // Model kadang mengirim tanda "-" kosong sebagai pemisah antarbagian.
    // Jangan tampilkan pemisah tersebut sebagai isi pesan.
    if (/^[-–—]+$/.test(line)) {
      flushList();
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      list.push((bullet || numbered)?.[1] || line);
      continue;
    }
    flushList();
    blocks.push(<p key={`p-${blocks.length}`}>{renderInline(line)}</p>);
  }
  flushList();

  return <div className="message-content">{blocks}</div>;
}
