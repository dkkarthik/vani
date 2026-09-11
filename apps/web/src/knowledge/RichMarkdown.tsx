import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
export function RichMarkdown({ text }: { text: string }) {
  return (
    <div className="rich-markdown">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { trust: false, strict: "warn" }]]}
        skipHtml
        components={{
          img: ({ src, alt }) =>
            typeof src === "string" &&
            /^\/api\/v1\/knowledge\/note-images\/[a-f0-9]{64}$/.test(src) ? (
              <img src={src} alt={alt ?? ""} />
            ) : (
              <span>[Image unavailable: upload a local image]</span>
            ),
          a: ({ href, children }) => (
            <a href={href} rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
