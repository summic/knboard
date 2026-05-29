import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

// Rendered, read-only Markdown. GFM enables tables/task-lists/strikethrough;
// rehype-highlight adds syntax highlighting (highlight.js token classes) to
// fenced code blocks — styled in styles.css to match the warm dark code block.
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose">
      {children.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {children}
        </ReactMarkdown>
      ) : (
        <p className="prose-empty">（空文档）</p>
      )}
    </div>
  );
}
