import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronRight, LogIn } from 'lucide-react';
import { SOURCE, api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { AttTag, Button, Card, Empty, ErrorBox, Loading, PageHeader, SectionTitle, Tag } from '../../components/ui';
import { fmtDate, fmtTime, greeting } from '../../lib/utils';

interface TeacherDash {
  date: string;
  myAttendance: { status: string; checkIn: string | null; checkOut: string | null } | null;
  sections: { id: string; label: string; students: number; marked: boolean; present: number; absent: number }[];
  subjects: { class: string; subject: string }[];
}

export function TeacherDashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['dashboard', 'teacher'],
    queryFn: async () => (await api.get<TeacherDash>('/dashboard/teacher')).data,
  });
  const checkIn = useMutation({
    mutationFn: () => api.post('/attendance/staff/check-in', { source: SOURCE }),
    onSuccess: () => (toast.success('Checked in. Have a great day!'), qc.invalidateQueries({ queryKey: ['dashboard'] })),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const me = d.myAttendance;

  return (
    <>
      <PageHeader
        icon="👋"
        title={`${greeting()}, ${user?.name.split(' ')[0]}`}
        description={fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}
      />

      {/* My check-in */}
      <Card className="p-4 flex items-center gap-3">
        <span className="text-2xl">📍</span>
        <div className="flex-1">
          <div className="font-medium text-ink-strong">My attendance</div>
          <div className="text-sm text-muted flex items-center gap-2 mt-0.5">
            <AttTag status={me?.status} />
            {me?.checkIn && <span>In {fmtTime(me.checkIn)}</span>}
            {me?.checkOut && <span>· Out {fmtTime(me.checkOut)}</span>}
          </div>
        </div>
        {!me?.checkIn ? (
          <Button variant="primary" icon={<LogIn className="size-4" />} loading={checkIn.isPending} onClick={() => checkIn.mutate()}>
            Check in
          </Button>
        ) : (
          <Link to="/me/attendance" className="text-faint p-1">
            <ChevronRight className="size-4" />
          </Link>
        )}
      </Card>

      <SectionTitle>My class</SectionTitle>
      {!d.sections.length ? (
        <Card>
          <Empty icon="🧑‍🏫" title="No class assigned">
            The Principal can make you class teacher from Classes & subjects.
          </Empty>
        </Card>
      ) : (
        <div className="space-y-3">
          {d.sections.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex items-center gap-3">
                <span className="size-11 rounded-md bg-sidebar border border-line flex items-center justify-center font-semibold text-ink-strong">
                  {s.label}
                </span>
                <div className="flex-1">
                  <div className="font-medium text-ink-strong">Class {s.label}</div>
                  <div className="text-sm text-muted">{s.students} students</div>
                </div>
                {s.marked ? (
                  <Tag color="green">
                    {s.present} present · {s.absent} absent
                  </Tag>
                ) : (
                  <Tag color="orange">Attendance pending</Tag>
                )}
              </div>
              <div className="flex gap-2 mt-3">
                <Link to={`/attendance/${s.id}`} className="flex-1">
                  <Button variant={s.marked ? 'secondary' : 'primary'} size="lg" className="w-full">
                    {s.marked ? 'Edit attendance' : 'Take attendance'}
                  </Button>
                </Link>
                <Link to={`/attendance/${s.id}/report`}>
                  <Button size="lg">Register</Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      {d.subjects.length > 0 && (
        <>
          <SectionTitle>Subjects I teach</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {d.subjects.map((s, i) => (
              <Tag key={i} color="blue">
                {s.subject} · {s.class}
              </Tag>
            ))}
          </div>
        </>
      )}
    </>
  );
}
