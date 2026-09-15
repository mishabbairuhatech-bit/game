import clsx from 'clsx';
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react';
import { forwardRef, useId } from 'react';

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brass-500 text-ink-950 hover:bg-brass-400 active:bg-brass-600 shadow-plate border border-brass-700',
  secondary:
    'bg-ink-800/80 text-parchment-100 hover:bg-ink-700 active:bg-ink-900 border border-ink-600',
  ghost: 'bg-transparent text-parchment-200 hover:bg-ink-800/60 border border-transparent',
  danger: 'bg-ember-600 text-white hover:bg-ember-500 active:bg-ember-700 border border-ember-800',
  gold: 'bg-gradient-to-b from-brass-300 to-brass-600 text-ink-950 hover:from-brass-200 hover:to-brass-500 border border-brass-800 shadow-plate',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon,
    fullWidth,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-md font-semibold tracking-wide',
        'transition-colors duration-150 select-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : leftIcon}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={clsx('animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                       */
/* -------------------------------------------------------------------------- */

// `title` is a ReactNode header here, not the DOM's tooltip attribute, so the
// native one is omitted from the extended props.
export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Removes the inner padding so the caller can lay out edge-to-edge. */
  flush?: boolean;
}

export function Panel({
  title,
  subtitle,
  actions,
  flush,
  className,
  children,
  ...rest
}: PanelProps) {
  return (
    <div
      className={clsx(
        'rounded-xl border border-ink-700/80 bg-ink-900/85 backdrop-blur-sm shadow-panel',
        className,
      )}
      {...rest}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-ink-700/70 px-4 py-3">
          <div>
            {title && (
              <h2 className="font-display text-sm uppercase tracking-[0.16em] text-brass-300">
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-xs text-parchment-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(!flush && 'p-4')}>{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Field                                                                       */
/* -------------------------------------------------------------------------- */

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-xs font-semibold uppercase tracking-wider text-parchment-400"
      >
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={clsx(
          'h-10 rounded-md border bg-ink-950/70 px-3 text-sm text-parchment-100',
          'placeholder:text-parchment-600',
          'focus:outline-none focus:ring-2 focus:ring-brass-400/70',
          error ? 'border-ember-500' : 'border-ink-600 focus:border-brass-500',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-xs text-ember-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-parchment-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/* Alert                                                                       */
/* -------------------------------------------------------------------------- */

export function Alert({
  tone = 'error',
  title,
  children,
}: {
  tone?: 'error' | 'warning' | 'info' | 'success';
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    error: 'border-ember-700/60 bg-ember-950/60 text-ember-200',
    warning: 'border-brass-700/60 bg-brass-950/50 text-brass-200',
    info: 'border-sky-800/60 bg-sky-950/50 text-sky-200',
    success: 'border-emerald-800/60 bg-emerald-950/50 text-emerald-200',
  } as const;

  return (
    <div role="alert" className={clsx('rounded-md border px-3 py-2 text-sm', tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={clsx(title && 'mt-0.5', 'text-[13px] leading-snug opacity-90')}>
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Badge                                                                       */
/* -------------------------------------------------------------------------- */

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'gold' | 'danger' | 'success' | 'info';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-ink-700 text-parchment-300 border-ink-600',
    gold: 'bg-brass-900/70 text-brass-200 border-brass-700',
    danger: 'bg-ember-950 text-ember-300 border-ember-800',
    success: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    info: 'bg-sky-950 text-sky-300 border-sky-800',
  } as const;

  return (
    <span
      className={clsx(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
