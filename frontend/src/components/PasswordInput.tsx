import { InputHTMLAttributes, useState } from 'react';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export function PasswordInput({ className = '', ...props }: PasswordInputProps) {
  const [visivel, setVisivel] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={visivel ? 'text' : 'password'}
        className={`${className} pr-12`}
      />
      <button
        type="button"
        onClick={() => setVisivel((atual) => !atual)}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted transition-colors hover:text-signal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/70"
        aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
        aria-pressed={visivel}
        title={visivel ? 'Ocultar senha' : 'Mostrar senha'}
      >
        {visivel ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="m3 3 18 18" />
            <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
            <path d="M9.9 4.3A10.7 10.7 0 0 1 12 4c5.5 0 9 5 9 8a10.8 10.8 0 0 1-2.1 3.7M6.5 6.5C4.3 8 3 10.2 3 12c0 3 3.5 8 9 8 1.2 0 2.3-.2 3.3-.7" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M3 12c0-3 3.5-8 9-8s9 5 9 8-3.5 8-9 8-9-5-9-8Z" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
        )}
      </button>
    </div>
  );
}
