import { useId, useState } from 'react';
import { useHub } from '../../entities/hub/hub-store';
import { t, type MessageKey } from '../../shared/i18n';
import type { DeniedReason } from '../../shared/protocol.ts';
import { AppMark } from '../../shared/ui/app-mark';
import './login-page.css';

const CODE = /^\d{6}$/;

// A saved token that stopped working sends a phone back here for a code.
const CODE_ERRORS = {
   token: 'login.denied.expired',
   code: 'login.denied.code',
   locked: 'login.denied.locked',
} as const satisfies Record<DeniedReason, MessageKey>;

// A phone logs in once with a code from the authenticator app and then stays logged in. The computer the hub runs on
// opens the app with `agent-hub open` instead.
export function LoginPage() {
   const enter = useHub((state) => state.enter);
   const denied = useHub((state) => state.denied);
   const [value, setValue] = useState('');
   const inputId = useId();
   const hintId = useId();
   const errorId = useId();
   const ready = CODE.test(value);
   const error = denied && CODE_ERRORS[denied];

   return (
      <main className="login-page">
         <form
            className="login-card"
            onSubmit={(event) => {
               event.preventDefault();
               if (!ready) return;
               enter(value);
               setValue('');
            }}
         >
            <AppMark className="login-logo" />
            <h1 className="login-title">{t('login.title')}</h1>
            <p className="login-hint" id={hintId}>
               {t('login.hint')}
            </p>
            <label className="login-label" htmlFor={inputId}>
               {t('login.code')}
            </label>
            <input
               id={inputId}
               className="login-input"
               type="text"
               inputMode="numeric"
               autoComplete="one-time-code"
               maxLength={6}
               value={value}
               aria-invalid={Boolean(error)}
               aria-describedby={error ? `${hintId} ${errorId}` : hintId}
               onChange={(event) => setValue(event.target.value.replace(/\D/g, ''))}
            />
            {error && (
               <p className="login-error" id={errorId} role="alert">
                  {t(error)}
               </p>
            )}
            <button className="login-submit" type="submit" disabled={!ready}>
               {t('login.submit')}
            </button>
         </form>
      </main>
   );
}
