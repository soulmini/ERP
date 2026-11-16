import { GUARDIAN_RELATION_LABELS, GUARDIAN_RELATIONS, STUDENT_BLOOD_GROUPS, STUDENT_CATEGORIES } from '@erp/shared';
import { Field, Input, Select, Textarea } from '../../components/ui';

export type Values = Record<string, string>;
type Def = { key: string; label: string; type?: 'date' | 'select' | 'textarea'; options?: readonly (string | [string, string])[]; wide?: boolean; hint?: string };

export const STUDENT_FIELDS: { title: string; fields: Def[] }[] = [
  {
    title: 'Student',
    fields: [
      { key: 'firstName', label: 'First name *' },
      { key: 'lastName', label: 'Last name' },
      { key: 'gender', label: 'Gender *', type: 'select', options: [['MALE', 'Boy'], ['FEMALE', 'Girl'], ['OTHER', 'Other']] },
      { key: 'dob', label: 'Date of birth *', type: 'date' },
      { key: 'bloodGroup', label: 'Blood group', type: 'select', options: ['', ...STUDENT_BLOOD_GROUPS] },
      { key: 'category', label: 'Category', type: 'select', options: ['', ...STUDENT_CATEGORIES] },
      { key: 'religion', label: 'Religion' },
      { key: 'caste', label: 'Caste' },
      { key: 'motherTongue', label: 'Mother tongue' },
      { key: 'nationality', label: 'Nationality' },
      { key: 'aadhaarNo', label: 'Aadhaar no.' },
      { key: 'srNo', label: 'SR (scholar register) no.' },
      { key: 'penNo', label: 'PEN (UDISE+)' },
      { key: 'admissionDate', label: 'Admission date', type: 'date' },
    ],
  },
  {
    title: 'Contact & address',
    fields: [
      { key: 'phone', label: 'Student mobile' },
      { key: 'email', label: 'Email' },
      { key: 'address', label: 'Address', wide: true },
      { key: 'city', label: 'City / village' },
      { key: 'state', label: 'State' },
      { key: 'pincode', label: 'PIN code' },
    ],
  },
  {
    title: 'Previous school & health',
    fields: [
      { key: 'previousSchool', label: 'Previous school' },
      { key: 'previousClass', label: 'Class passed there' },
      { key: 'medicalNotes', label: 'Medical notes / allergies', type: 'textarea', wide: true },
    ],
  },
];

export const PROFILE_KEYS = STUDENT_FIELDS.flatMap((g) => g.fields.map((f) => f.key));

export function FieldsGrid({ defs, v, set, errors }: { defs: Def[]; v: Values; set: (k: string, val: string) => void; errors: Record<string, string> }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {defs.map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint} error={errors[f.key]} className={f.wide ? 'sm:col-span-2' : ''}>
          {f.type === 'select' ? (
            <Select value={v[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
              {f.options!.map((o) => {
                const [val, label] = Array.isArray(o) ? o : [o, o || '—'];
                return (
                  <option key={val} value={val}>
                    {label}
                  </option>
                );
              })}
            </Select>
          ) : f.type === 'textarea' ? (
            <Textarea rows={2} value={v[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
          ) : (
            <Input type={f.type === 'date' ? 'date' : 'text'} value={v[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
          )}
        </Field>
      ))}
    </div>
  );
}

export const GUARDIAN_FIELDS: Def[] = [
  { key: 'relation', label: 'Relation', type: 'select', options: GUARDIAN_RELATIONS.map((r) => [r, GUARDIAN_RELATION_LABELS[r]] as [string, string]) },
  { key: 'name', label: 'Name *' },
  { key: 'phone', label: 'Mobile' },
  { key: 'email', label: 'Email' },
  { key: 'occupation', label: 'Occupation' },
  { key: 'qualification', label: 'Qualification' },
  { key: 'annualIncome', label: 'Annual income (₹)' },
  { key: 'aadhaarNo', label: 'Aadhaar no.' },
  { key: 'address', label: 'Address (if different)' },
];

/** Form strings → API payload: blanks stay '' (schemas turn them into null); income rupees → paise. */
export function guardianPayload(g: Values) {
  const income = (g.annualIncome ?? '').replace(/[,\s₹]/g, '');
  return { ...g, annualIncome: income === '' ? '' : /^\d+$/.test(income) ? String(Number(income) * 100) : income };
}
