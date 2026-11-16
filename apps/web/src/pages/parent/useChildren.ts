import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export interface Child {
  id: string;
  name: string;
  admissionNo: string;
  photoUrl: string | null;
  classLabel: string | null;
  rollNo: number | null;
  classTeacher: string | null;
  todayStatus: string | null;
  monthPercent: number | null;
}

const KEY = 'erp.child';

/** Children of the logged-in parent + the selected child (remembered across visits). */
export function useChildren() {
  const q = useQuery({ queryKey: ['children'], queryFn: async () => (await api.get<Child[]>('/parent/children')).data });
  const [selectedId, setSelectedId] = useState<string | null>(() => localStorage.getItem(KEY));
  useEffect(() => {
    if (q.data?.length && !q.data.some((c) => c.id === selectedId)) setSelectedId(q.data[0].id);
  }, [q.data, selectedId]);
  const select = (id: string) => {
    setSelectedId(id);
    localStorage.setItem(KEY, id);
  };
  return { ...q, children: q.data ?? [], child: q.data?.find((c) => c.id === selectedId) ?? q.data?.[0] ?? null, select };
}
