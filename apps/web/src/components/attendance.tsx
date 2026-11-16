import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ATT } from './ui';
import { cn, fmtMonth, shiftMonth } from '../lib/utils';

export const MARK_OPTIONS = ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE'] as const;
export type MarkStatus = (typeof MARK_OPTIONS)[number] | 'HOLIDAY';

const active: Record<string, string> = {
  PRESENT: 'bg-tag-green-ink text-white border-tag-green-ink',
  ABSENT: 'bg-tag-red-ink text-white border-tag-red-ink',
  LATE: 'bg-tag-orange-ink text-white border-tag-orange-ink',
  HALF_DAY: 'bg-tag-yellow-ink text-white border-tag-yellow-ink',
  LEAVE: 'bg-tag-blue-ink text-white border-tag-blue-ink',
};

/** Big tap-friendly P / A / L / H / LV buttons. */
export function StatusPicker({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (s: MarkStatus) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1">
      {MARK_OPTIONS.map((s) => (
        <button
          key={s}
          type="button"
          disabled={disabled}
          title={ATT[s].label}
          onClick={() => onChange(s)}
          className={cn(
            'h-9 min-w-9 px-1.5 rounded-md border text-[13px] font-semibold transition-colors disabled:opacity-60',
            value === s ? active[s] : 'bg-white border-line text-muted hover:bg-hover',
          )}
        >
          {ATT[s].short}
        </button>
      ))}
    </div>
  );
}

export function MonthNav({ month, onChange, max }: { month: string; onChange: (m: string) => void; max?: string }) {
  const next = shiftMonth(month, 1);
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-line bg-white">
      <button className="p-1.5 hover:bg-hover rounded-l-md" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month">
        <ChevronLeft className="size-4" />
      </button>
      <span className="text-sm font-medium w-32 text-center">{fmtMonth(month)}</span>
      <button
        className="p-1.5 hover:bg-hover rounded-r-md disabled:opacity-30"
        disabled={!!max && next > max}
        onClick={() => onChange(next)}
        aria-label="Next month"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

const cellCls: Record<string, string> = {
  P: 'bg-tag-green text-tag-green-ink',
  A: 'bg-tag-red text-tag-red-ink',
  L: 'bg-tag-orange text-tag-orange-ink',
  H: 'bg-tag-yellow text-tag-yellow-ink',
  LV: 'bg-tag-blue text-tag-blue-ink',
  HO: 'bg-tag-purple text-tag-purple-ink',
};

export function GridCell({ v }: { v?: string }) {
  return (
    <span className={cn('inline-flex size-6 items-center justify-center rounded text-[10.5px] font-semibold', v ? cellCls[v] : 'text-[#d3d3d0]')}>
      {v ?? '·'}
    </span>
  );
}

/** Month calendar with coloured status per day (parents & my attendance). */
export function AttendanceCalendar({
  month,
  records,
}: {
  month: string;
  records: { date: string; status: string }[];
}) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay(); // 0 = Sunday
  const days = new Date(y, m, 0).getDate();
  const byDay = new Map(records.map((r) => [Number(r.date.slice(8, 10)), r.status]));
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-faint mb-1">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          const st = d ? byDay.get(d) : undefined;
          return (
            <div
              key={i}
              className={cn(
                'aspect-square rounded-md flex flex-col items-center justify-center text-[13px]',
                !d && 'invisible',
                st ? cellCls[ATT[st].short] : 'bg-[#fafaf9] text-faint',
              )}
              title={st ? ATT[st].label : undefined}
            >
              <span className="font-medium">{d}</span>
              {st && <span className="text-[9px] font-semibold leading-none">{ATT[st].short}</span>}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-xs text-muted">
        {Object.entries(ATT).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className={cn('size-2 rounded-full bg-current', cellCls[v.short].split(' ')[1])} />
            {v.label}
          </span>
        ))}
      </div>
    </div>
  );
}
