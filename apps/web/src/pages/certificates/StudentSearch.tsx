import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '../../lib/api';
import { sectionOptions, useClasses } from '../../lib/queries';
import { Avatar, Card, Input, Select, Spinner, Tag } from '../../components/ui';

export interface FoundStudent {
  id: string;
  name: string;
  admissionNo: string;
  classLabel: string | null;
  status: string;
  fatherName: string;
}

interface ListItem {
  id: string;
  name: string;
  admissionNo: string;
  classLabel: string | null;
  rollNo: number | null;
  guardian: { name: string } | null;
}

/**
 * Pick a student: choose class & section to list its students (type to filter),
 * or leave class empty and search the whole school by name / admission no. (includes students who left).
 */
export function StudentSearch({ onPick, activeOnly }: { onPick: (s: FoundStudent) => void; activeOnly?: boolean }) {
  const classes = useClasses();
  const options = sectionOptions(classes.data);
  const [sectionId, setSectionId] = useState('');
  const [q, setQ] = useState('');
  const text = q.trim().toLowerCase();

  // Whole class (active students of the current session).
  const cls = useQuery({
    queryKey: ['cert-class-students', sectionId],
    enabled: !!sectionId,
    queryFn: async () => (await api.get<{ items: ListItem[] }>('/students', { params: { sectionId, pageSize: 100 } })).data.items,
  });
  // School-wide search (also finds students who have left — needed for TC / CC).
  const search = useQuery({
    queryKey: ['cert-students', text],
    enabled: !sectionId && text.length >= 2,
    queryFn: async () => (await api.get<FoundStudent[]>('/certificates/students', { params: { search: q.trim() } })).data,
  });

  const list: (FoundStudent & { rollNo?: number | null })[] = useMemo(() => {
    if (sectionId) {
      return (cls.data ?? [])
        .map((s) => ({ id: s.id, name: s.name, admissionNo: s.admissionNo, classLabel: s.classLabel, status: 'ACTIVE', fatherName: s.guardian?.name ?? '', rollNo: s.rollNo }))
        .sort((a, b) => (a.rollNo ?? 999) - (b.rollNo ?? 999))
        .filter((s) => !text || s.name.toLowerCase().includes(text) || s.admissionNo.toLowerCase().includes(text) || String(s.rollNo) === text);
    }
    return (search.data ?? []).filter((s) => !activeOnly || s.status === 'ACTIVE');
  }, [sectionId, cls.data, search.data, text, activeOnly]);

  const loading = sectionId ? cls.isFetching : search.isFetching;
  const showList = !!sectionId || text.length >= 2;

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-2">
        <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="sm:w-48">
          <option value="">All classes</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              Class {o.label}
            </option>
          ))}
        </Select>
        <div className="relative flex-1">
          <Search className="size-4 text-faint absolute left-2.5 top-2.5" />
          <Input
            autoFocus
            placeholder={sectionId ? 'Filter by name, roll or admission no.' : 'Search name or admission no. (whole school)'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
          {loading && <Spinner className="size-4 absolute right-2.5 top-2.5" />}
        </div>
      </div>
      {!showList && <p className="text-xs text-muted mt-2">Choose a class to see its students, or type at least 2 letters to search.</p>}
      {showList && !loading && (
        <Card className="mt-2 divide-y divide-line max-h-[60vh] overflow-y-auto">
          {!list.length && <div className="px-4 py-3 text-sm text-muted">No student found</div>}
          {list.map((s) => (
            <button key={s.id} onClick={() => onPick(s)} className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-hover">
              {s.rollNo != null && <span className="w-6 text-right text-sm text-faint tabular-nums">{s.rollNo}</span>}
              <Avatar name={s.name} size={28} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-ink-strong">{s.name}</div>
                <div className="text-xs text-muted">
                  {s.admissionNo}
                  {s.fatherName && ` · Parent: ${s.fatherName}`}
                </div>
              </div>
              {s.classLabel && !sectionId && <Tag color="blue">{s.classLabel}</Tag>}
              {s.status !== 'ACTIVE' && <Tag color="gray">{s.status === 'LEFT' ? 'Left' : 'Passed out'}</Tag>}
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}
