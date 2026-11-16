import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Search } from 'lucide-react';
import { CERT_META, CERT_TYPES, type CertType } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { Button, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Tag } from '../../components/ui';
import { fmtDate } from '../../lib/utils';

interface Row {
  id: string;
  type: CertType;
  serialNo: string;
  issueDate: string;
  student: { name: string; admissionNo: string };
  className: string | null;
  issuedBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export function RegisterPage() {
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [cancelling, setCancelling] = useState<Row | null>(null);
  const q = useQuery({
    queryKey: ['certificates', type, search],
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<Row[]>('/certificates', { params: { type: type || undefined, search: search || undefined } })).data,
  });
  return (
    <>
      <Link to="/certificates" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> Certificates
      </Link>
      <PageHeader icon="📚" title="Issue register" description="Every certificate issued. Reprints use the saved copy, so they always match the original." />
      <div className="flex flex-wrap gap-2 mb-4">
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-auto">
          <option value="">All types</option>
          {CERT_TYPES.map((t) => (
            <option key={t} value={t}>
              {CERT_META[t].title}
            </option>
          ))}
        </Select>
        <div className="relative flex-1 min-w-48">
          <Search className="size-4 text-faint absolute left-2.5 top-2.5" />
          <Input placeholder="Serial no., student or admission no." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data!.length ? (
        <Empty icon="📜" title="No certificates issued yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Serial no.</th>
              <th>Student</th>
              <th>Issued</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data!.map((c) => (
              <tr key={c.id}>
                <td>
                  <div className="font-medium text-ink-strong tabular-nums">{c.serialNo}</div>
                  <div className="text-xs text-muted">{CERT_META[c.type].title}</div>
                </td>
                <td>
                  <div>{c.student.name}</div>
                  <div className="text-xs text-muted">
                    {c.student.admissionNo}
                    {c.className && ` · ${c.className}`}
                  </div>
                </td>
                <td className="text-muted text-sm">
                  {fmtDate(c.issueDate)}
                  {c.issuedBy && <div className="text-xs">by {c.issuedBy}</div>}
                </td>
                <td>{c.cancelledAt ? <Tag color="red">Cancelled</Tag> : <Tag color="green">Valid</Tag>}</td>
                <td>
                  <div className="flex justify-end gap-1">
                    <Link to={`/certificates/view/${c.id}${c.cancelledAt ? '' : '?duplicate=1'}`}>
                      <Button size="sm">{c.cancelledAt ? 'View' : 'Reprint'}</Button>
                    </Link>
                    {!c.cancelledAt && (
                      <Button size="sm" variant="danger" onClick={() => setCancelling(c)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {cancelling && <CancelModal cert={cancelling} onClose={() => setCancelling(null)} />}
    </>
  );
}

function CancelModal({ cert, onClose }: { cert: Row; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [restore, setRestore] = useState(true);
  const m = useMutation({
    mutationFn: () => api.post(`/certificates/view/${cert.id}/cancel`, { reason, restoreStudent: cert.type === 'TC' ? restore : undefined }),
    onSuccess: () => (toast.success('Certificate cancelled'), qc.invalidateQueries({ queryKey: ['certificates'] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Cancel ${cert.serialNo}?`}
      footer={
        <>
          <Button onClick={onClose}>Keep</Button>
          <Button variant="danger" disabled={reason.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>
            Cancel certificate
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2">
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="e.g. issued with wrong date of birth" />
        </Field>
        {cert.type === 'TC' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={restore} onChange={(e) => setRestore(e.target.checked)} /> Mark {cert.student.name} as an active student again
          </label>
        )}
      </div>
    </Modal>
  );
}
