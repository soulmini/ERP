import { Router } from 'express';
import { DEFAULT_ACCOUNT_CATEGORIES, accountCategorySchema, accountTxnSchema } from '@erp/shared';
import { prisma } from '../db';
import type { Prisma } from '../generated/prisma/client';
import { badRequest, notFound, optStr, parse, str } from '../lib/http';
import { currentMonthStr, dateOnly, monthRange, toDateStr, todayStr } from '../lib/dates';
import { audit } from '../lib/audit';
import { authOf, can } from '../middleware/auth';

/** Income / expense ledger, day book, monthly summary. */
export const accountsRouter = Router();
accountsRouter.use(can('accounts.manage'));

const DAY = 86_400_000;

/** [from, to] as Dates (to inclusive → exclusive end). Defaults: this month. */
function range(fromQ: unknown, toQ: unknown) {
  const from = optStr(fromQ) ?? `${currentMonthStr()}-01`;
  const to = optStr(toQ) ?? todayStr();
  const start = dateOnly(from);
  const end = new Date(dateOnly(to).getTime() + DAY);
  if (end <= start) throw badRequest('“To” date must be on or after “From” date');
  if (end.getTime() - start.getTime() > 400 * DAY) throw badRequest('Choose a range of at most one year');
  return { from, to, start, end };
}

// ───────── Categories ─────────

accountsRouter.get('/categories', async (req, res) => {
  const { sid } = authOf(req);
  if (!(await prisma.accountCategory.count({ where: { schoolId: sid } }))) {
    await prisma.accountCategory.createMany({ data: DEFAULT_ACCOUNT_CATEGORIES.map((c) => ({ ...c, schoolId: sid })), skipDuplicates: true });
  }
  const cats = await prisma.accountCategory.findMany({
    where: { schoolId: sid },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { transactions: true } } },
  });
  res.json(cats.map(({ _count, ...c }) => ({ ...c, used: _count.transactions })));
});

accountsRouter.post('/categories', async (req, res) => {
  const { sid } = authOf(req);
  const c = await prisma.accountCategory.create({ data: { ...parse(accountCategorySchema, req.body), schoolId: sid } });
  res.status(201).json(c);
});

accountsRouter.put('/categories/:id', async (req, res) => {
  const { sid } = authOf(req);
  const r = await prisma.accountCategory.updateMany({ where: { id: str(req.params.id), schoolId: sid }, data: parse(accountCategorySchema, req.body) });
  if (!r.count) throw notFound('Category not found');
  res.json({ ok: true });
});

accountsRouter.delete('/categories/:id', async (req, res) => {
  const { sid } = authOf(req);
  const id = str(req.params.id);
  if (await prisma.transaction.count({ where: { categoryId: id, schoolId: sid } })) {
    throw badRequest('This category has entries. Move or delete them first.');
  }
  const r = await prisma.accountCategory.deleteMany({ where: { id, schoolId: sid } });
  if (!r.count) throw notFound('Category not found');
  res.json({ ok: true });
});

// ───────── Transactions ─────────

async function assertCategory(schoolId: string, categoryId: string, type: string) {
  const c = await prisma.accountCategory.findFirst({ where: { id: categoryId, schoolId } });
  if (!c) throw badRequest('Choose a valid category');
  if (c.type !== type) throw badRequest(`“${c.name}” is an ${c.type.toLowerCase()} category`);
}

accountsRouter.get('/transactions', async (req, res) => {
  const { sid } = authOf(req);
  const { start, end } = range(req.query.from, req.query.to);
  const type = optStr(req.query.type);
  const categoryId = optStr(req.query.categoryId);
  const search = optStr(req.query.search)?.trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const where: Prisma.TransactionWhereInput = {
    schoolId: sid,
    date: { gte: start, lt: end },
    ...(type === 'INCOME' || type === 'EXPENSE' ? { type } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(search
      ? {
          OR: [
            { party: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { reference: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [total, items, sums] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * 50,
      take: 50,
      include: { category: { select: { id: true, name: true } } },
    }),
    prisma.transaction.groupBy({ by: ['type'], where, _sum: { amount: true } }),
  ]);
  const sum = (t: string) => sums.find((s) => s.type === t)?._sum.amount ?? 0;
  res.json({
    total,
    page,
    pageSize: 50,
    totals: { income: sum('INCOME'), expense: sum('EXPENSE') },
    items: items.map((t) => ({ ...t, date: toDateStr(t.date) })),
  });
});

accountsRouter.post('/transactions', async (req, res) => {
  const a = authOf(req);
  const input = parse(accountTxnSchema, req.body);
  await assertCategory(a.sid, input.categoryId, input.type);
  const t = await prisma.transaction.create({ data: { ...input, date: dateOnly(input.date), schoolId: a.sid, createdById: a.sub } });
  audit(req, 'transaction.create', 'Transaction', t.id, { type: t.type, amount: t.amount });
  res.status(201).json(t);
});

accountsRouter.put('/transactions/:id', async (req, res) => {
  const a = authOf(req);
  const input = parse(accountTxnSchema, req.body);
  await assertCategory(a.sid, input.categoryId, input.type);
  const r = await prisma.transaction.updateMany({
    where: { id: str(req.params.id), schoolId: a.sid },
    data: { ...input, party: input.party ?? null, description: input.description ?? null, reference: input.reference ?? null, date: dateOnly(input.date) },
  });
  if (!r.count) throw notFound('Entry not found');
  audit(req, 'transaction.update', 'Transaction', str(req.params.id), { amount: input.amount });
  res.json({ ok: true });
});

accountsRouter.delete('/transactions/:id', async (req, res) => {
  const a = authOf(req);
  const r = await prisma.transaction.deleteMany({ where: { id: str(req.params.id), schoolId: a.sid } });
  if (!r.count) throw notFound('Entry not found');
  audit(req, 'transaction.delete', 'Transaction', str(req.params.id));
  res.json({ ok: true });
});

// ───────── Day book (fees + salaries + manual entries) ─────────

interface BookEntry {
  id: string;
  source: 'FEE' | 'SALARY' | 'MANUAL';
  date: string;
  type: 'INCOME' | 'EXPENSE';
  title: string;
  category: string;
  mode: string;
  reference: string | null;
  amount: number;
}

async function bookEntries(schoolId: string, start: Date, end: Date): Promise<BookEntry[]> {
  const [fees, salaries, manual] = await Promise.all([
    prisma.payment.findMany({
      where: { schoolId, cancelledAt: null, date: { gte: start, lt: end } },
      include: { student: { select: { firstName: true, lastName: true, admissionNo: true } } },
    }),
    prisma.payslip.findMany({
      where: { paidAt: { gte: start, lt: end }, payroll: { schoolId } },
      include: { staff: { select: { firstName: true, lastName: true } }, payroll: { select: { month: true } } },
    }),
    prisma.transaction.findMany({ where: { schoolId, date: { gte: start, lt: end } }, include: { category: { select: { name: true } } } }),
  ]);
  return [
    ...fees.map<BookEntry>((p) => ({
      id: p.id,
      source: 'FEE',
      date: toDateStr(p.date),
      type: 'INCOME',
      title: `Fee receipt ${p.receiptNo} – ${[p.student.firstName, p.student.lastName].filter(Boolean).join(' ')}`,
      category: 'Fee collection',
      mode: p.mode,
      reference: p.reference,
      amount: p.amount,
    })),
    ...salaries.map<BookEntry>((s) => ({
      id: s.id,
      source: 'SALARY',
      date: toDateStr(new Date(`${s.paidAt!.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}T00:00:00Z`)),
      type: 'EXPENSE',
      title: `Salary – ${`${s.staff.firstName} ${s.staff.lastName ?? ''}`.trim()} (${s.payroll.month})`,
      category: 'Salaries',
      mode: s.paymentMode ?? 'BANK_TRANSFER',
      reference: s.reference,
      amount: s.net,
    })),
    ...manual.map<BookEntry>((t) => ({
      id: t.id,
      source: 'MANUAL',
      date: toDateStr(t.date),
      type: t.type,
      title: [t.party, t.description].filter(Boolean).join(' – ') || t.category?.name || 'Entry',
      category: t.category?.name ?? 'Uncategorised',
      mode: t.mode,
      reference: t.reference,
      amount: t.amount,
    })),
  ].sort((x, y) => x.date.localeCompare(y.date) || x.source.localeCompare(y.source));
}

accountsRouter.get('/daybook', async (req, res) => {
  const { sid } = authOf(req);
  const { from, to, start, end } = range(req.query.from, req.query.to);
  const entries = await bookEntries(sid, start, end);
  const income = entries.filter((e) => e.type === 'INCOME').reduce((n, e) => n + e.amount, 0);
  const expense = entries.filter((e) => e.type === 'EXPENSE').reduce((n, e) => n + e.amount, 0);
  const byMode: Record<string, { income: number; expense: number }> = {};
  for (const e of entries) {
    const m = (byMode[e.mode] ??= { income: 0, expense: 0 });
    m[e.type === 'INCOME' ? 'income' : 'expense'] += e.amount;
  }
  res.json({ from, to, entries, totals: { income, expense, net: income - expense }, byMode });
});

/** Income vs expense by category for a month. */
accountsRouter.get('/summary', async (req, res) => {
  const { sid } = authOf(req);
  const month = optStr(req.query.month) ?? currentMonthStr();
  const { from, to } = monthRange(month);
  const entries = await bookEntries(sid, from, to);
  const group = (type: 'INCOME' | 'EXPENSE') => {
    const m = new Map<string, number>();
    for (const e of entries.filter((x) => x.type === type)) m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
    return [...m.entries()].map(([category, amount]) => ({ category, amount })).sort((x, y) => y.amount - x.amount);
  };
  const income = group('INCOME');
  const expense = group('EXPENSE');
  const total = (l: { amount: number }[]) => l.reduce((n, x) => n + x.amount, 0);
  res.json({ month, income, expense, totals: { income: total(income), expense: total(expense), net: total(income) - total(expense) } });
});
