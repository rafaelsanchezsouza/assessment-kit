import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { en, GafApiClient, GuidedCapture, ptBR } from '@gaf/capture-web';

// Dev-only host proving the SDK end-to-end against apps/reference (via the
// vite /api proxy) using the NEUTRAL demo protocol — deliberately no domain
// content, per ADR-006: the SDK must work without any domain knowledge.
const PROTOCOL_ID = 'backyard-quick-check';
const PROTOCOL_VERSION = '0.1.0';

function App() {
  const [lang, setLang] = useState<'en' | 'pt-BR'>('en');
  const [run, setRun] = useState(0);
  const client = useMemo(() => new GafApiClient({ baseUrl: '/api' }), []);
  const newSubject = useMemo(() => ({ type: 'backyard', ownerId: 'demo-user' }), []);

  return (
    <div>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '1.2rem' }}>GAF capture demo</h1>
        <span>
          <button type="button" onClick={() => setLang(lang === 'en' ? 'pt-BR' : 'en')}>
            {lang === 'en' ? 'PT-BR' : 'EN'}
          </button>{' '}
          <button type="button" onClick={() => setRun((n) => n + 1)}>
            ↺
          </button>
        </span>
      </header>
      <GuidedCapture
        key={`${lang}-${run}`}
        client={client}
        protocolId={PROTOCOL_ID}
        protocolVersion={PROTOCOL_VERSION}
        newSubject={newSubject}
        strings={lang === 'en' ? en : ptBR}
        onCompleted={(findings) => console.log('completed with findings', findings)}
      />
      <footer style={{ marginTop: '2rem', fontSize: '0.8rem', color: '#666' }}>
        <p>
          Reviewer side (Wizard-of-Oz): <code>POST /reviews/:assessmentId</code> on :3002 — see the
          reference app README.
        </p>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
