import { memo } from 'react';
import { MarkdownText } from '../../shared/ui/markdown';
import './agent-message.css';

export const AgentMessage = memo(function AgentMessage({ text, streaming }: { text: string; streaming: boolean }) {
   return (
      <div className="agent-message">
         <MarkdownText text={text} caret={streaming} />
      </div>
   );
});
