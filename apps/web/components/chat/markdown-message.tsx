"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownMessageProps = {
  content: string;
};

/**
 * Keeps model-authored Markdown inside the same restrained surface as a Luna
 * message. Raw HTML is deliberately not enabled, so Markdown remains text
 * content rather than an execution surface.
 */
export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="min-w-0 break-words text-[15px] leading-6">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          h1: ({ children }) => (
            <h1 className="mb-3 text-xl font-semibold tracking-[-0.025em] last:mb-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2.5 text-lg font-semibold tracking-[-0.02em] last:mb-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 text-[15px] font-semibold last:mb-0">{children}</h3>
          ),
          ul: ({ children }) => (
            <ul className="mb-3 list-disc space-y-1.5 pl-5 marker:text-slate-400 last:mb-0">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 list-decimal space-y-1.5 pl-5 marker:text-slate-500 last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-slate-300/85 bg-slate-50/65 py-1 pl-3.5 pr-2 text-slate-600 last:mb-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-slate-200/80" />,
          a: ({ children, href }) => (
            <a
              className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 transition hover:decoration-slate-600"
              href={href}
              rel="noreferrer"
              target="_blank"
            >
              {children}
            </a>
          ),
          code: ({ children, className }) => {
            const isBlock = Boolean(className) || String(children).includes("\n");

            return (
              <code
                className={
                  isBlock
                    ? "font-mono text-[13px] leading-6 text-slate-800"
                    : "rounded-md border border-slate-200/80 bg-slate-100/85 px-1.5 py-0.5 font-mono text-[0.84em] text-slate-800"
                }
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-xl border border-slate-200/80 bg-slate-950/[0.035] p-3 shadow-inner shadow-slate-200/35 last:mb-0">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <table className="my-3 w-full border-separate border-spacing-0 overflow-hidden rounded-xl border border-slate-200/80 text-left text-[13px] last:mb-0">
              {children}
            </table>
          ),
          thead: ({ children }) => <thead className="bg-slate-50/75">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-slate-200/80 px-2.5 py-2 font-medium text-slate-600">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-slate-100/90 px-2.5 py-2 align-top last:border-b-0">
              {children}
            </td>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
