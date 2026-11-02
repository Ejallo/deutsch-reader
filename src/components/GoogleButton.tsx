import { useEffect, useRef, useState } from 'react';
import { ACCOUNT_API } from '../lib/sync';

// OAuth client from Google Cloud Console (public; set after creating the client)
export const GOOGLE_CLIENT_ID = '638517168513-2n5pta330caejvn46sfljo74dd4tlhk8.apps.googleusercontent.com';

type Gis = {
  accounts: {
    id: {
      initialize: (o: object) => void;
      renderButton: (el: HTMLElement, o: object) => void;
    };
  };
};

let loading: Promise<Gis> | null = null;

function loadGis(): Promise<Gis> {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve((window as unknown as { google: Gis }).google);
    s.onerror = () => reject(new Error('Не удалось загрузить вход Google — проверь интернет'));
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * «Sign in with Google» in redirect mode: popups don't work in an iOS home-screen app,
 * so Google posts the sign-in to our server, which sends the browser back with a session.
 */
export function GoogleButton() {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(() => {
    const failed = sessionStorage.getItem('loginError');
    sessionStorage.removeItem('loginError');
    return failed ? 'Не получилось войти через Google — попробуй ещё раз' : '';
  });

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const dev = location.hostname === 'localhost';
    loadGis()
      .then((google) => {
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          ux_mode: 'redirect',
          login_uri: `${ACCOUNT_API}/auth/google/${dev ? 'dev' : 'prod'}`,
        });
        if (ref.current) google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'ru', width: 300 });
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (!GOOGLE_CLIENT_ID) return <p className="muted small">Вход через Google скоро появится.</p>;
  return (
    <div className="google-btn">
      <div ref={ref} />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
