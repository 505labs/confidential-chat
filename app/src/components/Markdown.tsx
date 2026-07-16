"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";

// LLMs emit math with mixed delimiters. remark-math only understands $…$ / $$…$$,
// so convert \[ … \] → $$…$$ and \( … \) → $…$ — but never inside code spans/fences.
function normalizeMath(src: string): string {
  return src
    .split(/(```[\s\S]*?```|`[^`]*`)/g)
    .map((seg, i) =>
      i % 2 === 1
        ? seg // a code fence / inline code — leave untouched
        : seg
            .replace(/\\\[([\s\S]+?)\\\]/g, (_m, x) => `$$${x}$$`)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_m, x) => `$${x}$`),
    )
    .join("");
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none prose-p:my-1.5 prose-headings:mb-2 prose-headings:mt-3 prose-li:my-0.5 prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          pre: (props) => (
            <pre
              className="overflow-x-auto rounded-lg border border-white/10 bg-[#0d1117] p-3 text-[13px] leading-snug"
              {...props}
            />
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className || "");
            return (
              <code
                className={
                  isBlock
                    ? className
                    : "rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em] text-emerald-200"
                }
                {...props}
              >
                {children}
              </code>
            );
          },
          a: (props) => <a target="_blank" rel="noreferrer" {...props} />,
          table: (props) => (
            <div className="overflow-x-auto">
              <table {...props} />
            </div>
          ),
        }}
      >
        {normalizeMath(children)}
      </ReactMarkdown>
    </div>
  );
}
