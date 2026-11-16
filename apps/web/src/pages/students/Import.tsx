import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Download, Upload } from 'lucide-react';
import { STUDENT_IMPORT_COLUMNS, STUDENT_IMPORT_OPTIONAL_COLUMNS } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { Button, Card, PageHeader, Table, Tag } from '../../components/ui';
import { downloadCsv } from '../../lib/utils';

type Row = { line: number; data: Record<string, string> };
type Checked = { line: number; ok: boolean; errors: string[]; data?: { firstName: string; lastName: string | null; classLabel: string; guardianPhone: string } };

/** Minimal CSV parser: quoted fields, escaped quotes, commas/newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

export function ImportStudents() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [checked, setChecked] = useState<Checked[] | null>(null);
  const [fileName, setFileName] = useState('');

  const check = useMutation({
    mutationFn: async (r: Row[]) => (await api.post<{ rows: Checked[]; valid: number; invalid: number }>('/admissions/import?dryRun=1', { rows: r })).data,
    onSuccess: (d) => setChecked(d.rows),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const run = useMutation({
    mutationFn: async () => (await api.post<{ created: number; parentLogins: number; skipped: number }>('/admissions/import', { rows })).data,
    onSuccess: (d) => {
      toast.success(`Imported ${d.created} students · ${d.parentLogins} new parent logins${d.skipped ? ` · ${d.skipped} rows skipped` : ''}`, { duration: 8000 });
      qc.invalidateQueries({ queryKey: ['students'] });
      setRows([]);
      setChecked(null);
      setFileName('');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onFile = async (f: File) => {
    const grid = parseCsv(await f.text());
    if (grid.length < 2) return toast.error('The file has no student rows');
    const header = grid[0].map((h) => h.trim());
    const missing = STUDENT_IMPORT_COLUMNS.filter((c) => !header.includes(c));
    if (missing.length) return toast.error(`Missing columns: ${missing.join(', ')}. Download the template.`);
    const parsed = grid.slice(1).map((cells, i) => ({ line: i + 2, data: Object.fromEntries(header.map((h, j) => [h, (cells[j] ?? '').trim()])) }));
    setFileName(f.name);
    setRows(parsed);
    check.mutate(parsed);
  };
  const valid = checked?.filter((c) => c.ok).length ?? 0;

  return (
    <>
      <Link to="/students" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> Students
      </Link>
      <PageHeader icon="📥" title="Import students" description="Add many students at once from Excel. Save the sheet as CSV, upload it, check the preview, then import." />
      <Card className="p-4 mb-4 flex flex-wrap items-center gap-2">
        <Button
          icon={<Download className="size-4" />}
          onClick={() =>
            downloadCsv('students-template.csv', [
              [...STUDENT_IMPORT_COLUMNS, ...STUDENT_IMPORT_OPTIONAL_COLUMNS],
              ['Aman', 'Kumar', 'M', '15-05-2018', '3', 'A', '', 'Rajesh Kumar', '9876543210', 'Bumnagar', '', 'Father'],
            ])
          }
        >
          Download template
        </Button>
        <Button variant="primary" icon={<Upload className="size-4" />} loading={check.isPending} onClick={() => fileRef.current?.click()}>
          Choose CSV file
        </Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => (e.target.files?.[0] && onFile(e.target.files[0]), (e.target.value = ''))} />
        {fileName && <span className="text-sm text-muted">{fileName}</span>}
        <span className="text-xs text-muted w-full">
          Gender: M / F. Dates: DD-MM-YYYY or YYYY-MM-DD. Blank roll / admission no. are numbered automatically. Each parent gets an app login (mobile = password).
        </span>
      </Card>
      {checked && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <Tag color="green">{valid} ready</Tag>
            {checked.length - valid > 0 && <Tag color="red">{checked.length - valid} with errors (will be skipped)</Tag>}
            <Button variant="primary" className="ml-auto" disabled={!valid} loading={run.isPending} onClick={() => run.mutate()}>
              Import {valid} students
            </Button>
          </div>
          <Table>
            <thead>
              <tr>
                <th>Line</th>
                <th>Student</th>
                <th>Class</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {checked.map((c) => {
                const raw = rows.find((r) => r.line === c.line)?.data ?? {};
                return (
                  <tr key={c.line} className={c.ok ? '' : 'bg-[#fffafa]'}>
                    <td className="text-muted">{c.line}</td>
                    <td>{`${raw.firstName ?? ''} ${raw.lastName ?? ''}`.trim() || '—'}</td>
                    <td>{c.data?.classLabel ?? `${raw.class ?? ''}-${raw.section ?? ''}`}</td>
                    <td>{c.ok ? <Tag color="green">OK</Tag> : <span className="text-xs text-tag-red-ink">{c.errors.join(' · ')}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </>
      )}
    </>
  );
}
