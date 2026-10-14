import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type UrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

function sanitizeHref(href: string) {
  const trimmed = href.trim().replace(/^<|>$/g, "");
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return url.toString();
    }
  } catch {
    return null;
  }

  return null;
}

const markdownUrlTransform: UrlTransform = (url, key, node) => {
  const transformed = defaultUrlTransform(url);
  return typeof transformed === "string" ? sanitizeHref(transformed) : null;
};

const markdownComponents: Components = {
  a({ children, className, href, ...props }) {
    const safeHref = typeof href === "string" ? sanitizeHref(href) : null;
    if (!safeHref) {
      return <>{children}</>;
    }

    return (
      <a
        {...props}
        className={cn("break-all", className)}
        href={safeHref}
        rel="noreferrer noopener"
        target="_blank"
      >
        {children}
      </a>
    );
  },
  input({ checked, className, type, ...props }) {
    if (type !== "checkbox") {
      return null;
    }

    return (
      <input
        {...props}
        checked={checked}
        className={cn("mr-2 align-middle accent-current", className)}
        disabled
        readOnly
        type="checkbox"
      />
    );
  },
  table({ children, className, ...props }) {
    return (
      <div className="overflow-x-auto">
        <table {...props} className={cn("min-w-full", className)}>
          {children}
        </table>
      </div>
    );
  },
};

const markdownClassName = cn(
  "agent-msg-markdown",
  "prose prose-sm max-w-none break-words text-inherit prose-invert",
  "prose-p:text-inherit prose-strong:text-inherit prose-em:text-inherit",
  "prose-headings:text-inherit prose-li:text-inherit prose-blockquote:text-inherit",
  "prose-code:text-inherit prose-pre:text-inherit prose-th:text-inherit prose-td:text-inherit",
  "prose-a:text-inherit prose-a:decoration-current/40 prose-a:underline-offset-4",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-pre:overflow-x-auto prose-pre:rounded-2xl prose-pre:border prose-pre:border-white/10",
  "prose-pre:bg-black/30 prose-pre:shadow-none",
);

export function AgentMessageMarkdown({
  className,
  content,
}: {
  className?: string;
  content: string;
}) {
  return (
    <div className={cn(markdownClassName, className)}>
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={markdownUrlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
