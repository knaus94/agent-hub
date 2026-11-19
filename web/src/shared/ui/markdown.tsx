import { createContext, memo, useContext, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './markdown.css';

// Opens a Markdown file of the project. base is the path of the document being read, which its relative links start
// from; in a chat it is empty and paths start from the project.
export const MarkdownFiles = createContext<{ open: (path: string) => void; base: string } | null>(null);

// A path to a Markdown file as an agent writes it, maybe with a line or an anchor after it; null for anything else.
function markdownPath(text: string) {
   const path = text.replace(/(:\d+(-\d+)?|#.*)$/, '');
   return /^[^\s*?<>|"'`]+\.(md|markdown)$/i.test(path) && !/^[a-z][a-z\d+.-]*:/i.test(path) ? path : null;
}

// nearPath resolves a link's path against the document it is in.
function nearPath(base: string, path: string) {
   if (path.startsWith('/')) return path;
   const parts = base.split('/').slice(0, -1);
   for (const part of path.split('/')) {
      const last = parts.at(-1);
      if (part === '..' && last !== undefined && last !== '' && last !== '..') parts.pop();
      else if (part !== '.' && part !== '') parts.push(part);
   }
   return parts.join('/');
}

function Link({ href, children }: { href?: string; children?: ReactNode }) {
   const files = useContext(MarkdownFiles);
   const path = files && href && !href.startsWith('//') ? markdownPath(safeDecode(href)) : null;
   if (files && path)
      return (
         <button className="md-link md-file" type="button" onClick={() => files.open(nearPath(files.base, path))}>
            {children}
         </button>
      );
   return (
      <a className="md-link" href={href} target="_blank" rel="noopener noreferrer">
         {children}
      </a>
   );
}

function safeDecode(text: string) {
   try {
      return decodeURIComponent(text);
   } catch {
      return text;
   }
}

function Code({ className, children }: { className?: string; children?: ReactNode }) {
   const files = useContext(MarkdownFiles);
   const text = String(children);
   if (className || text.includes('\n')) return <code className="md-code-block">{children}</code>;
   const path = files ? markdownPath(text) : null;
   if (files && path)
      return (
         <button className="md-code md-file" type="button" onClick={() => files.open(path)}>
            {children}
         </button>
      );
   return <code className="md-code">{children}</code>;
}

const components: Components = {
   p: ({ children }) => <p className="md-paragraph">{children}</p>,
   a: ({ children, href }) => <Link href={href}>{children}</Link>,
   ul: ({ children }) => <ul className="md-list">{children}</ul>,
   ol: ({ children, start }) => (
      <ol className="md-list" start={start}>
         {children}
      </ol>
   ),
   li: ({ children }) => <li className="md-item">{children}</li>,
   h1: ({ children }) => <h3 className="md-heading">{children}</h3>,
   h2: ({ children }) => <h3 className="md-heading">{children}</h3>,
   h3: ({ children }) => <h4 className="md-heading md-heading--small">{children}</h4>,
   h4: ({ children }) => <h4 className="md-heading md-heading--small">{children}</h4>,
   blockquote: ({ children }) => <blockquote className="md-quote">{children}</blockquote>,
   hr: () => <hr className="md-rule" />,
   pre: ({ children }) => <pre className="md-pre">{children}</pre>,
   code: ({ className, children }) => <Code className={className}>{children}</Code>,
   table: ({ children }) => (
      <div className="md-table-wrap">
         <table className="md-table">{children}</table>
      </div>
   ),
   th: ({ children }) => <th className="md-cell md-cell--head">{children}</th>,
   td: ({ children }) => <td className="md-cell">{children}</td>,
};

// A document keeps its outline: each level its own size, one level under the heading of the dialog it is shown in.
const documentComponents: Components = {
   ...components,
   h1: ({ children }) => <h3 className="md-heading md-heading--1">{children}</h3>,
   h2: ({ children }) => <h4 className="md-heading md-heading--2">{children}</h4>,
   h3: ({ children }) => <h5 className="md-heading md-heading--3">{children}</h5>,
   h4: ({ children }) => <h6 className="md-heading md-heading--small">{children}</h6>,
   h5: ({ children }) => <h6 className="md-heading md-heading--small">{children}</h6>,
   h6: ({ children }) => <h6 className="md-heading md-heading--small">{children}</h6>,
};

// `caret` marks text that is still being written; a "document" is a whole file read on its own rather than a message.
export const MarkdownText = memo(function MarkdownText({
   text,
   caret = false,
   variant = 'message',
}: {
   text: string;
   caret?: boolean;
   variant?: 'message' | 'document';
}) {
   return (
      <div className="md" data-caret={caret}>
         <Markdown remarkPlugins={[remarkGfm]} components={variant === 'document' ? documentComponents : components}>
            {text}
         </Markdown>
      </div>
   );
});
