import { useRef, useState, useLayoutEffect } from "react";
import {
  Columns2,
  Pencil,
  Eye,
  Bold,
  Italic,
  Heading,
  List,
  ListOrdered,
  Quote,
  Code,
  Link as LinkIcon,
} from "lucide-react";
import { Markdown } from "./Markdown";

type Mode = "write" | "split" | "preview";

const MODES: { id: Mode; label: string; icon: typeof Pencil }[] = [
  { id: "write", label: "编辑", icon: Pencil },
  { id: "split", label: "分屏", icon: Columns2 },
  { id: "preview", label: "预览", icon: Eye },
];

// Result of a toolbar transform: the new full text plus the selection to
// restore afterwards.
type Edit = { text: string; selStart: number; selEnd: number };

// Wrap the selection (or the caret) with `marker` on both sides, e.g. **bold**.
function wrap(marker: string, ph: string) {
  return (v: string, s: number, e: number): Edit => {
    const sel = v.slice(s, e) || ph;
    const text = v.slice(0, s) + marker + sel + marker + v.slice(e);
    const selStart = s + marker.length;
    return { text, selStart, selEnd: selStart + sel.length };
  };
}

// Prefix every line spanning the selection, e.g. "## " or "- ".
function linePrefix(prefix: string | ((i: number) => string)) {
  return (v: string, s: number, e: number): Edit => {
    const lineStart = v.lastIndexOf("\n", s - 1) + 1;
    const nl = v.indexOf("\n", e);
    const lineEnd = nl === -1 ? v.length : nl;
    const block = v
      .slice(lineStart, lineEnd)
      .split("\n")
      .map((ln, i) => (typeof prefix === "function" ? prefix(i) : prefix) + ln)
      .join("\n");
    const text = v.slice(0, lineStart) + block + v.slice(lineEnd);
    return { text, selStart: lineStart, selEnd: lineStart + block.length };
  };
}

function link() {
  return (v: string, s: number, e: number): Edit => {
    const label = v.slice(s, e) || "链接文字";
    const text = v.slice(0, s) + `[${label}](url)` + v.slice(e);
    const urlStart = s + 1 + label.length + 2; // past "[label]("
    return { text, selStart: urlStart, selEnd: urlStart + 3 }; // selects "url"
  };
}

type Tool = { key: string; label: string; icon: typeof Bold; run: (v: string, s: number, e: number) => Edit; shortcut?: string };

const TOOLS: Tool[] = [
  { key: "bold", label: "加粗", icon: Bold, run: wrap("**", "加粗文字"), shortcut: "b" },
  { key: "italic", label: "斜体", icon: Italic, run: wrap("*", "斜体文字"), shortcut: "i" },
  { key: "heading", label: "标题", icon: Heading, run: linePrefix("## ") },
  { key: "ul", label: "项目列表", icon: List, run: linePrefix("- ") },
  { key: "ol", label: "有序列表", icon: ListOrdered, run: linePrefix((i) => `${i + 1}. `) },
  { key: "quote", label: "引用", icon: Quote, run: linePrefix("> ") },
  { key: "code", label: "行内代码", icon: Code, run: wrap("`", "代码") },
  { key: "link", label: "链接", icon: LinkIcon, run: link(), shortcut: "k" },
];

// Edits raw Markdown with a formatting toolbar + live preview. The on-disk
// file stays byte-for-byte what you type — no reformatting.
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [mode, setMode] = useState<Mode>("split");
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSel = useRef<[number, number] | null>(null);

  // Restore the selection synchronously after the new value is in the DOM.
  // (useLayoutEffect fires regardless of tab visibility, unlike rAF.)
  useLayoutEffect(() => {
    const ta = ref.current;
    if (ta && pendingSel.current) {
      const [s, e] = pendingSel.current;
      pendingSel.current = null;
      ta.focus();
      ta.setSelectionRange(s, e);
    }
  });

  const apply = (tool: Tool) => {
    const ta = ref.current;
    if (!ta) return;
    const { text, selStart, selEnd } = tool.run(value, ta.selectionStart, ta.selectionEnd);
    pendingSel.current = [selStart, selEnd];
    onChange(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const tool = TOOLS.find((t) => t.shortcut === e.key.toLowerCase());
    if (tool) {
      e.preventDefault();
      apply(tool);
    }
  };

  return (
    <div className="md-editor">
      <div className="md-editor-bar">
        <div className="md-editor-toggle" role="group" aria-label="编辑模式">
          {MODES.map((m) => {
            const I = m.icon;
            return (
              <button
                key={m.id}
                className={mode === m.id ? "is-active" : ""}
                onClick={() => setMode(m.id)}
                aria-pressed={mode === m.id}
              >
                <I size={14} aria-hidden /> {m.label}
              </button>
            );
          })}
        </div>

        {mode !== "preview" && (
          <div className="md-toolbar" role="toolbar" aria-label="格式">
            {TOOLS.map((t) => {
              const I = t.icon;
              return (
                <button
                  key={t.key}
                  className="md-tool"
                  onClick={() => apply(t)}
                  title={t.shortcut ? `${t.label} (⌘/Ctrl+${t.shortcut.toUpperCase()})` : t.label}
                  aria-label={t.label}
                >
                  <I size={15} aria-hidden />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className={`md-editor-panes mode-${mode}`}>
        {mode !== "preview" && (
          <textarea
            ref={ref}
            className="md-editor-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            spellCheck={false}
          />
        )}
        {mode !== "write" && (
          <div className="md-editor-preview">
            <Markdown>{value}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}
