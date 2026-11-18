import { CircleCheck, CircleHelp, CircleSlash, ExternalLink, ShieldQuestion } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import type { QuestionEntry, QuestionField, QuestionResponse } from '../../shared/protocol.ts';
import { useHub } from '../hub/hub-store';
import { t } from '../../shared/i18n';
import './question-card.css';

const MODE_ICONS = { permission: ShieldQuestion, form: CircleHelp, url: ExternalLink } as const;

type Values = Record<string, string | string[]>;

function Field({
   field,
   value,
   onChange,
}: {
   field: QuestionField;
   value: string | string[] | undefined;
   onChange: (value: string | string[]) => void;
}) {
   const id = useId();
   const descriptionId = useId();
   if (field.kind === 'text') {
      return (
         <div className="question-field">
            <label className="question-field-title" htmlFor={id}>
               {field.title ?? field.key}
            </label>
            {field.description && (
               <p className="question-field-description" id={descriptionId}>
                  {field.description}
               </p>
            )}
            <textarea
               id={id}
               className="question-input"
               rows={2}
               value={typeof value === 'string' ? value : ''}
               aria-describedby={field.description ? descriptionId : undefined}
               onChange={(event) => onChange(event.target.value)}
            />
         </div>
      );
   }
   const picked = Array.isArray(value) ? value : value ? [value] : [];
   return (
      <fieldset className="question-field">
         <legend className="question-field-title">{field.title ?? field.key}</legend>
         {field.description && <p className="question-field-description">{field.description}</p>}
         <div className="question-choices">
            {field.options.map((option) => (
               <label key={option.id} className="question-choice">
                  <input
                     className="question-choice-input"
                     type={field.multiple ? 'checkbox' : 'radio'}
                     name={id}
                     checked={picked.includes(option.id)}
                     onChange={(event) => {
                        if (!field.multiple) onChange(option.id);
                        else onChange(event.target.checked ? [...picked, option.id] : picked.filter((item) => item !== option.id));
                     }}
                  />
                  <span className="question-choice-text">
                     <span className="question-choice-label">{option.label}</span>
                     {option.description && <span className="question-choice-description">{option.description}</span>}
                  </span>
               </label>
            ))}
         </div>
      </fieldset>
   );
}

// An agent waiting for the user. Whoever answers first, here or in Zed, settles it; the card then shows the answer.
export function QuestionCard({ entry }: { entry: QuestionEntry }) {
   const answer = useHub((state) => state.answer);
   const failed = useHub((state) => state.failure?.reason === 'answer-failed');
   const [sent, setSent] = useState(false);
   const [values, setValues] = useState<Values>({});
   const messageId = useId();
   const Icon = MODE_ICONS[entry.mode];

   if (entry.status !== 'pending') {
      const answered = entry.status === 'answered';
      const StatusIcon = answered ? CircleCheck : CircleSlash;
      return (
         <div className="question" data-status={entry.status}>
            <p className="question-message">{entry.message}</p>
            <p className="question-result">
               <StatusIcon className="question-result-icon" aria-hidden="true" />
               {answered ? (entry.answer ? t('question.answer', { answer: entry.answer }) : t('question.answered')) : t('question.cancelled')}
            </p>
         </div>
      );
   }

   const busy = sent && !failed;
   const reply = (response: QuestionResponse) => {
      setSent(true);
      answer(entry.id, response);
   };
   const submit = (event: FormEvent) => {
      event.preventDefault();
      const content = Object.fromEntries(
         Object.entries(values).filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value.trim() !== '')),
      );
      reply({ action: 'accept', content });
   };
   const link = entry.url && /^https?:\/\//.test(entry.url) ? entry.url : null;

   return (
      <form className="question" data-status="pending" aria-labelledby={messageId} onSubmit={submit}>
         <fieldset className="question-body" disabled={busy}>
            <p className="question-kind">
               <Icon className="question-kind-icon" aria-hidden="true" />
               {t(`question.${entry.mode}`)}
            </p>
            {entry.message && (
               <p className="question-message" id={messageId}>
                  {entry.message}
               </p>
            )}
            {entry.mode === 'form' &&
               entry.fields.map((field) => (
                  <Field
                     key={field.key}
                     field={field}
                     value={values[field.key]}
                     onChange={(value) => setValues({ ...values, [field.key]: value })}
                  />
               ))}
            {link && (
               <p className="question-link" title={link}>
                  {link}
               </p>
            )}
            <div className="question-actions">
               {entry.mode === 'permission' &&
                  entry.options.map((option) => (
                     <button
                        key={option.id}
                        className="question-button"
                        type="button"
                        data-tone={option.kind?.startsWith('reject') ? 'quiet' : option.kind === 'allow_once' ? 'primary' : 'plain'}
                        onClick={() => reply({ optionId: option.id })}
                     >
                        {option.label}
                     </button>
                  ))}
               {entry.mode === 'form' && (
                  <>
                     <button className="question-button" type="submit" data-tone="primary">
                        {t('question.submit')}
                     </button>
                     <button className="question-button" type="button" data-tone="quiet" onClick={() => reply({ action: 'decline' })}>
                        {t('question.skip')}
                     </button>
                  </>
               )}
               {entry.mode === 'url' && (
                  <>
                     {link && (
                        <a
                           className="question-button"
                           data-tone="primary"
                           href={link}
                           target="_blank"
                           rel="noopener noreferrer"
                           onClick={() => reply({ action: 'accept' })}
                        >
                           {t('question.open')}
                        </a>
                     )}
                     <button className="question-button" type="button" data-tone="quiet" onClick={() => reply({ action: 'decline' })}>
                        {t('question.decline')}
                     </button>
                  </>
               )}
            </div>
            {busy && (
               <p className="question-sending" role="status">
                  {t('question.sending')}
               </p>
            )}
         </fieldset>
      </form>
   );
}
