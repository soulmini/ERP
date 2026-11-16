import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { amountInWords, type ReceiptDetail } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { Letterhead, PrintSheet, PrintToolbar } from '../../components/print';
import { Button, ErrorBox, Field, Input, Loading, Modal } from '../../components/ui';
import { fmtDate } from '../../lib/utils';
import { inr, modeLabel, useFeePerms } from './common';

export function ReceiptPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const p = useFeePerms();
  const nav = useNavigate();
  const [cancelling, setCancelling] = useState(false);
  const q = useQuery({
    queryKey: ['fees', 'receipt', id],
    queryFn: async () => (await api.get<ReceiptDetail>(`/fees/payments/${id}`)).data,
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data!;
  return (
    <>
      <PrintToolbar title={r.receiptNo}>
        {p.any && <Button onClick={() => nav(`/fees/student/${r.student.id}`)}>Fee card</Button>}
        {p.collect && params.get('new') && (
          <Button variant="secondary" onClick={() => nav('/fees')}>
            Next student
          </Button>
        )}
        {p.manage && !r.cancelledAt && (
          <Button variant="danger" onClick={() => setCancelling(true)}>
            Cancel receipt
          </Button>
        )}
      </PrintToolbar>
      {r.cancelledAt && (
        <div className="no-print rounded-md bg-tag-red text-tag-red-ink px-3 py-2 text-sm mb-4">
          Cancelled on {fmtDate(r.cancelledAt)} — {r.cancelReason}
        </div>
      )}
      <PrintSheet className="!p-0 md:!p-0">
        <ReceiptCopy r={r} copy="School copy" />
        <div className="relative border-t border-dashed border-black/50 my-0 print:my-[4mm]">
          <span className="absolute left-1/2 -translate-x-1/2 -top-2.5 bg-white px-2 text-[10px] text-black/50">✂ cut here</span>
        </div>
        <ReceiptCopy r={r} copy="Parent copy" />
      </PrintSheet>
      {cancelling && <CancelModal r={r} onClose={() => setCancelling(false)} />}
    </>
  );
}

function ReceiptCopy({ r, copy }: { r: ReceiptDetail; copy: string }) {
  const s = r.student;
  const totalConcession = r.lines.reduce((n, l) => n + l.concession, 0);
  return (
    <div className="relative overflow-hidden p-5 md:p-8 print:p-0 print:h-[128mm] break-inside-avoid">
      {r.cancelledAt && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
          <div className="-rotate-12 border-[6px] border-tag-red-ink/70 text-tag-red-ink/70 rounded-lg px-8 py-2 text-6xl font-black tracking-widest">
            CANCELLED
          </div>
        </div>
      )}
      <div className="flex justify-end -mb-5">
        <span className="text-[10px] uppercase tracking-wider border border-black/40 rounded px-1.5 py-0.5">{copy}</span>
      </div>
      <Letterhead title="Fee Receipt" compact />
      <div className="flex justify-between text-[13px] mb-2">
        <div>
          Receipt No: <b>{r.receiptNo}</b>
        </div>
        <div>
          Date: <b>{fmtDate(r.date)}</b>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 text-[12px] mb-3">
        <Info label="Student" value={s.name} />
        <Info label="Class" value={s.classLabel ?? '—'} />
        <Info label="Roll No" value={s.rollNo ?? '—'} />
        <Info label="Adm. No" value={s.admissionNo} />
        <Info label="Father's name" value={s.fatherName ?? s.guardianName ?? '—'} />
        <Info label="Session" value={r.session} />
      </div>
      <table className="w-full text-[12px] border-collapse [&_td]:border [&_th]:border [&_td]:border-black/60 [&_th]:border-black/60 [&_td]:px-1.5 [&_td]:py-1 [&_th]:px-1.5 [&_th]:py-1">
        <thead>
          <tr className="bg-black/5">
            <th className="w-6 text-center">#</th>
            <th className="text-left">Particulars</th>
            <th className="text-left">Period</th>
            <th className="text-right">Fee</th>
            {totalConcession > 0 && <th className="text-right">Concession</th>}
            {r.totalFine > 0 && <th className="text-right">Late fine</th>}
            <th className="text-right">Paid</th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l, i) => (
            <tr key={l.head}>
              <td className="text-center">{i + 1}</td>
              <td>{l.head}</td>
              <td>{l.periods}</td>
              <td className="text-right tabular-nums">{inr(l.fee)}</td>
              {totalConcession > 0 && <td className="text-right tabular-nums">{l.concession ? `−${inr(l.concession)}` : '—'}</td>}
              {r.totalFine > 0 && <td className="text-right tabular-nums">{l.fine ? inr(l.fine) : '—'}</td>}
              <td className="text-right tabular-nums">{inr(l.paid)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td colSpan={4 + (totalConcession > 0 ? 1 : 0) + (r.totalFine > 0 ? 1 : 0)} className="text-right">
              Total received
            </td>
            <td className="text-right tabular-nums">{inr(r.amount)}</td>
          </tr>
        </tbody>
      </table>
      <div className="text-[12px] mt-2">
        <b>In words:</b> {amountInWords(r.amount)}
      </div>
      <div className="flex flex-wrap justify-between gap-x-4 text-[12px] mt-1">
        <div>
          <b>Mode:</b> {modeLabel(r.mode)}
          {r.reference ? ` (${r.reference})` : ''}
          {r.remarks ? ` · ${r.remarks}` : ''}
        </div>
        {!r.cancelledAt && r.balanceDue > 0 && (
          <div>
            <b>Balance due as on {fmtDate(new Date())}:</b> {inr(r.balanceDue)}
          </div>
        )}
      </div>
      {r.cancelledAt && (
        <div className="text-[12px] mt-1 text-tag-red-ink">
          <b>Cancelled</b> on {fmtDate(r.cancelledAt)}: {r.cancelReason}
        </div>
      )}
      <div className="flex justify-between items-end gap-6 mt-8 text-[12px]">
        <div>Collected by: {r.collectedBy ?? '—'}</div>
        <div className="text-center w-44">
          <div className="border-t border-black pt-1">Cashier / Accountant</div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="truncate">
      <span className="text-black/60">{label}: </span>
      <b>{value}</b>
    </div>
  );
}

function CancelModal({ r, onClose }: { r: ReceiptDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: async () => api.post(`/fees/payments/${r.id}/cancel`, { reason }),
    onSuccess: () => {
      toast.success(`Receipt ${r.receiptNo} cancelled; dues restored`);
      qc.invalidateQueries({ queryKey: ['fees'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Cancel receipt ${r.receiptNo}?`}
      footer={
        <>
          <Button onClick={onClose}>Keep receipt</Button>
          <Button variant="danger" loading={cancel.isPending} disabled={reason.trim().length < 3} onClick={() => cancel.mutate()}>
            Cancel receipt
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2 text-sm">
        <p>
          {inr(r.amount)} from <b>{r.student.name}</b> will be reversed and the dues it paid become unpaid again. The receipt stays on record,
          marked <b>CANCELLED</b>.
        </p>
        <Field label="Reason">
          <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cheque bounced, wrong student" />
        </Field>
      </div>
    </Modal>
  );
}
