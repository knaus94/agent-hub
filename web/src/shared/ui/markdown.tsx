import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './markdown.css';

const components: Components = {
   p: ({ children }) => <p className="md-paragraph">{children}</p>,
   a: ({ children, href }) => (
      <a className="md-link" href={href} target="_blank" rel="noopener noreferrer">
         {children}
      </a>
   ),
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
   code: ({ className, children }) => {
      const block = Boolean(className) || String(children).includes('\n');
      return <code className={block ? 'md-code-block' : 'md-code'}>{children}</code>;
   },
   table: ({ children }) => (
      <div className="md-table-wrap">
         <table className="md-table">{children}</table>
      </div>
   ),
   th: ({ children }) => <th className="md-cell md-cell--head">{children}</th>,
   td: ({ children }) => <td className="md-cell">{children}</td>,
};

// `caret` marks text that is still being written.
export const MarkdownText = memo(function MarkdownText({ text, caret = false }: { text: string; caret?: boolean }) {
   return (
      <div className="md" data-caret={caret}>
         <Markdown remarkPlugins={[remarkGfm]} components={components}>
            {text}
         </Markdown>
      </div>
   );
});
