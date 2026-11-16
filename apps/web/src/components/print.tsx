import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Button } from './ui';
import { cn } from '../lib/utils';

/**
 * Shared print building blocks for receipts, certificates, marksheets, I-cards, payslips.
 * Pages print with the browser's print dialog (Ctrl+P / "Save as PDF").
 * The app sidebar / bars are hidden automatically when printing.
 */

export interface SchoolInfo {
  id: string;
  name: string;
  code: string | null;
  affiliation: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  principalName: string | null;
  logoUrl: string | null;
}

export const useSchool = () =>
  useQuery({ queryKey: ['school'], queryFn: async () => (await api.get<SchoolInfo>('/school')).data, staleTime: 5 * 60_000 });

/** Back + Print buttons shown above a printable document (hidden on paper). */
export function PrintToolbar({ title, children }: { title?: string; children?: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="no-print flex flex-wrap items-center gap-2 mb-4">
      <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => nav(-1)}>
        Back
      </Button>
      {title && <span className="font-medium text-ink-strong">{title}</span>}
      <div className="ml-auto flex gap-2">
        {children}
        <Button variant="primary" icon={<Printer className="size-4" />} onClick={() => window.print()}>
          Print / Save PDF
        </Button>
      </div>
    </div>
  );
}

/** A4-like white sheet. On screen it looks like paper; on print it fills the page. */
export function PrintSheet({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'print-sheet bg-white mx-auto w-full max-w-[210mm] border border-line shadow-card p-6 md:p-10 text-[13px] text-black',
        'print:border-0 print:shadow-none print:p-0 print:max-w-none',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** School letterhead: logo, name, affiliation, address, contact. */
export function Letterhead({ title, compact }: { title?: string; compact?: boolean }) {
  const { data: s } = useSchool();
  if (!s) return null;
  const address = [s.address, s.city, s.state, s.pincode].filter(Boolean).join(', ');
  const contact = [s.phone && `Ph: ${s.phone}`, s.email, s.website].filter(Boolean).join(' · ');
  return (
    <div className={cn('text-center border-b-2 border-black', compact ? 'pb-2 mb-3' : 'pb-3 mb-5')}>
      <div className="flex items-center justify-center gap-3">
        {s.logoUrl && <img src={s.logoUrl} alt="" className={compact ? 'size-10 object-contain' : 'size-16 object-contain'} />}
        <div>
          <div className={cn('font-bold uppercase tracking-wide', compact ? 'text-base' : 'text-xl')}>{s.name}</div>
          {s.affiliation && <div className="text-[12px]">{s.affiliation}{s.code ? ` · Code ${s.code}` : ''}</div>}
          {address && <div className="text-[12px]">{address}</div>}
          {contact && !compact && <div className="text-[11px]">{contact}</div>}
        </div>
      </div>
      {title && (
        <div className={cn('inline-block mt-2 px-4 py-0.5 border border-black font-semibold uppercase tracking-wider', compact ? 'text-[12px]' : 'text-sm')}>
          {title}
        </div>
      )}
    </div>
  );
}

/** Signature lines at the bottom of a document. */
export function Signatures({ labels }: { labels: string[] }) {
  return (
    <div className="flex justify-between gap-6 mt-14 text-[12px]">
      {labels.map((l) => (
        <div key={l} className="text-center flex-1">
          <div className="border-t border-black pt-1">{l}</div>
        </div>
      ))}
    </div>
  );
}
