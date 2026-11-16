import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { Loader2, X } from 'lucide-react';
import { cn, initials } from '../lib/utils';

// ─────────────── Button ───────────────

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const btn: Record<BtnVariant, string> = {
  primary: 'bg-ink-strong text-white hover:bg-black shadow-card',
  secondary: 'bg-white text-ink border border-line hover:bg-hover',
  ghost: 'text-ink hover:bg-hover',
  danger: 'bg-white text-tag-red-ink border border-line hover:bg-tag-red',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }
>(({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...p }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    className={cn(
      'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors whitespace-nowrap select-none',
      'disabled:opacity-50 disabled:pointer-events-none',
      size === 'sm' && 'h-7 px-2.5 text-[13px]',
      size === 'md' && 'h-8 px-3 text-sm',
      size === 'lg' && 'h-11 px-5 text-[15px]',
      btn[variant],
      className,
    )}
    {...p}
  >
    {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
    {children}
  </button>
));

// ─────────────── Form controls ───────────────

const control =
  'w-full h-9 rounded-md border border-line bg-white px-2.5 text-sm text-ink placeholder:text-faint ' +
  'hover:border-[#d3d3d0] focus:border-[#2383e2] focus:ring-2 focus:ring-[#2383e2]/20 outline-none transition';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(control, className)} {...p} />
));

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...p }, ref) => (
    <select ref={ref} className={cn(control, 'pr-8', className)} {...p}>
      {children}
    </select>
  ),
);

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 4, ...p }, ref) => (
    <textarea ref={ref} rows={rows} className={cn(control, 'h-auto py-2 leading-relaxed resize-y', className)} {...p} />
  ),
);

export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="text-[13px] font-medium text-muted">{label}</span>
      {children}
      {error ? <span className="block text-xs text-tag-red-ink">{error}</span> : hint ? <span className="block text-xs text-faint">{hint}</span> : null}
    </label>
  );
}

// ─────────────── Layout bits ───────────────

/** Notion-style page header: emoji icon, big title, muted description, actions. */
export function PageHeader({
  icon,
  title,
  description,
  actions,
}: {
  icon?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 md:mb-8">
      {icon && <div className="text-4xl md:text-5xl leading-none mb-3 select-none">{icon}</div>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-[32px] font-bold tracking-tight text-ink-strong leading-tight">{title}</h1>
          {description && <p className="text-muted mt-1">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ className, children, ...p }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-lg border border-line bg-white', className)} {...p}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2 mt-8 first:mt-0">
      <h2 className="text-[13px] font-semibold text-muted uppercase tracking-wide">{children}</h2>
      {action}
    </div>
  );
}

export function Stat({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-[13px] text-muted">
        {icon && <span>{icon}</span>}
        {label}
      </div>
      <div className="text-2xl font-semibold text-ink-strong mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </Card>
  );
}

// ─────────────── Tags ───────────────

export type TagColor = 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red';
const tagCls: Record<TagColor, string> = {
  gray: 'bg-tag-gray text-tag-gray-ink',
  brown: 'bg-tag-brown text-tag-brown-ink',
  orange: 'bg-tag-orange text-tag-orange-ink',
  yellow: 'bg-tag-yellow text-tag-yellow-ink',
  green: 'bg-tag-green text-tag-green-ink',
  blue: 'bg-tag-blue text-tag-blue-ink',
  purple: 'bg-tag-purple text-tag-purple-ink',
  pink: 'bg-tag-pink text-tag-pink-ink',
  red: 'bg-tag-red text-tag-red-ink',
};

export function Tag({ color = 'gray', children, className }: { color?: TagColor; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', tagCls[color], className)}>
      {children}
    </span>
  );
}

export const ATT: Record<string, { label: string; short: string; color: TagColor }> = {
  PRESENT: { label: 'Present', short: 'P', color: 'green' },
  ABSENT: { label: 'Absent', short: 'A', color: 'red' },
  LATE: { label: 'Late', short: 'L', color: 'orange' },
  HALF_DAY: { label: 'Half day', short: 'H', color: 'yellow' },
  LEAVE: { label: 'Leave', short: 'LV', color: 'blue' },
  HOLIDAY: { label: 'Holiday', short: 'HO', color: 'purple' },
};

export function AttTag({ status }: { status: string | null | undefined }) {
  if (!status) return <Tag>Not marked</Tag>;
  const s = ATT[status];
  return (
    <Tag color={s.color}>
      <span className="size-1.5 rounded-full bg-current" />
      {s.label}
    </Tag>
  );
}

// ─────────────── Feedback ───────────────

export const Spinner = ({ className }: { className?: string }) => (
  <Loader2 className={cn('size-5 animate-spin text-faint', className)} />
);

export function Loading() {
  return (
    <div className="flex justify-center py-16">
      <Spinner />
    </div>
  );
}

export function Empty({ icon = '📭', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="text-center py-14 px-4">
      <div className="text-4xl mb-3">{icon}</div>
      <div className="font-medium text-ink-strong">{title}</div>
      {children && <div className="text-muted text-sm mt-1 max-w-sm mx-auto">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg =
    (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? (error as Error)?.message ?? 'Something went wrong';
  return <div className="rounded-md bg-tag-red text-tag-red-ink px-3 py-2 text-sm">{msg}</div>;
}

export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  const palette = ['#e7f3f8', '#edf3ec', '#fbecdd', '#f6f3f9', '#faf1f5', '#fbf3db'];
  const ink = ['#337ea9', '#448361', '#d9730d', '#9065b0', '#c14c8a', '#cb912f'];
  const i = [...name].reduce((n, c) => n + c.charCodeAt(0), 0) % palette.length;
  return src ? (
    <img src={src} alt="" className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
  ) : (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold shrink-0"
      style={{ width: size, height: size, background: palette[i], color: ink[i], fontSize: size * 0.38 }}
    >
      {initials(name)}
    </span>
  );
}

// ─────────────── Modal (bottom sheet on phones) ───────────────

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        className={cn(
          'relative bg-white w-full rounded-t-xl md:rounded-xl shadow-pop flex flex-col max-h-[92vh]',
          wide ? 'md:max-w-2xl' : 'md:max-w-lg',
        )}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h3 className="text-lg font-semibold text-ink-strong">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-hover text-muted" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-2 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2 pb-safe">{footer}</div>}
      </div>
    </div>
  );
}

// ─────────────── Tabs (Notion view tabs) ───────────────

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-line mb-5 overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'flex items-center gap-1.5 px-2 pb-2 pt-1 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors',
            value === t.value ? 'border-ink-strong text-ink-strong font-medium' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Simple table wrapper that scrolls horizontally on phones. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-4 md:mx-0">
      <table className="w-full text-sm border-collapse min-w-[560px] [&_th]:text-left [&_th]:font-normal [&_th]:text-muted [&_th]:text-[13px] [&_th]:px-3 [&_th]:py-2 [&_th]:border-b [&_th]:border-line [&_td]:px-3 [&_td]:py-2.5 [&_td]:border-b [&_td]:border-line [&_tbody_tr:hover]:bg-[#fafaf9]">
        {children}
      </table>
    </div>
  );
}
