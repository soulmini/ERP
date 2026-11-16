/** Demo data for Accounts & Inventory (salary demo data is added by the payroll module). Idempotent. */
import { DEFAULT_ACCOUNT_CATEGORIES } from '@erp/shared';
import { prisma } from '../../src/db';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

const TXNS: { date: string; type: 'INCOME' | 'EXPENSE'; category: string; rupees: number; mode: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE'; party: string; description?: string; reference?: string }[] = [
  { date: '2026-10-05', type: 'EXPENSE', category: 'Electricity', rupees: 4820, mode: 'UPI', party: 'UPPCL', description: 'September bill', reference: 'UP-2309-118' },
  { date: '2026-10-08', type: 'EXPENSE', category: 'Stationery', rupees: 1650, mode: 'CASH', party: 'Sharma Book Depot', description: 'Registers & chalk' },
  { date: '2026-10-15', type: 'EXPENSE', category: 'Maintenance', rupees: 2200, mode: 'CASH', party: 'Ramesh Electricals', description: 'Fan repair, 3 classrooms' },
  { date: '2026-10-18', type: 'EXPENSE', category: 'Events', rupees: 3500, mode: 'CASH', party: 'Dussehra celebration', description: 'Decoration & sweets' },
  { date: '2026-10-25', type: 'INCOME', category: 'Donation', rupees: 11000, mode: 'BANK_TRANSFER', party: 'Gupta Traders', description: 'Library books donation' },
  { date: '2026-11-04', type: 'EXPENSE', category: 'Electricity', rupees: 4310, mode: 'UPI', party: 'UPPCL', description: 'October bill', reference: 'UP-2310-121' },
  { date: '2026-11-06', type: 'EXPENSE', category: 'Water', rupees: 600, mode: 'CASH', party: 'Jal Sansthan' },
  { date: '2026-11-09', type: 'EXPENSE', category: 'Stationery', rupees: 980, mode: 'CASH', party: 'Sharma Book Depot', description: 'Printer paper' },
  { date: '2026-11-12', type: 'EXPENSE', category: 'Transport fuel', rupees: 2500, mode: 'CASH', party: 'Indian Oil, Bumnagar', description: 'School van diesel' },
  { date: '2026-11-14', type: 'INCOME', category: 'Other income', rupees: 1200, mode: 'CASH', party: 'Scrap paper sale' },
];

const ITEMS: { name: string; category: string; unit: string; minStock: number; rupees: number; opening: number; issued?: [number, string][] }[] = [
  { name: 'Chalk box (white)', category: 'Stationery', unit: 'box', minStock: 10, rupees: 45, opening: 40, issued: [[12, 'Class teachers'], [8, 'Class teachers']] },
  { name: 'Attendance register', category: 'Stationery', unit: 'pcs', minStock: 5, rupees: 120, opening: 20, issued: [[11, 'All classes']] },
  { name: 'Whiteboard marker', category: 'Stationery', unit: 'pcs', minStock: 15, rupees: 25, opening: 30, issued: [[18, 'Teachers']] },
  { name: 'Printer paper A4', category: 'Stationery', unit: 'ream', minStock: 4, rupees: 290, opening: 10, issued: [[3, 'Office']] },
  { name: 'Duster', category: 'Stationery', unit: 'pcs', minStock: 5, rupees: 30, opening: 15 },
  { name: 'Football', category: 'Sports', unit: 'pcs', minStock: 2, rupees: 450, opening: 4, issued: [[1, 'PT period']] },
  { name: 'Cricket bat', category: 'Sports', unit: 'pcs', minStock: 2, rupees: 650, opening: 3 },
  { name: 'Phenyl (5 L)', category: 'Cleaning', unit: 'can', minStock: 2, rupees: 260, opening: 6, issued: [[3, 'Sweeper']] },
];

/** Monthly salary in rupees: [basic, hra, da, conveyance, pf] + bank details, by staff first name. */
const SALARIES: Record<string, { pay: [number, number, number, number, number]; bank: [string, string, string, string] }> = {
  Shivam: { pay: [20000, 3000, 2000, 1000, 1800], bank: ['State Bank of India', '30214567891', 'SBIN0012345', 'ABCPJ1234K'] },
  Anita: { pay: [11000, 1500, 1000, 500, 900], bank: ['Bank of Baroda', '45120100012345', 'BARB0BUMNAG', 'BVQPV5678L'] },
  Rakesh: { pay: [10000, 1500, 800, 500, 800], bank: ['Punjab National Bank', '1234000100056789', 'PUNB0123400', 'CKDPY9012M'] },
};

export async function seedDemoFinance(schoolId: string) {
  const principal = await prisma.user.findFirst({ where: { schoolId, roles: { some: { role: { kind: 'PRINCIPAL' } } } } });

  // Salary structures (payroll itself is generated from the Salary screen)
  for (const [firstName, { pay, bank }] of Object.entries(SALARIES)) {
    const staff = await prisma.staff.findFirst({ where: { schoolId, firstName }, include: { salaryStructure: true } });
    if (!staff || staff.salaryStructure) continue;
    const [basic, hra, da, conveyance, pf] = pay.map((r) => r * 100);
    await prisma.salaryStructure.create({ data: { staffId: staff.id, basic, hra, da, conveyance, pf, effectiveFrom: d('2026-04-01') } });
    if (!staff.bankAccount) {
      await prisma.staff.update({ where: { id: staff.id }, data: { bankName: bank[0], bankAccount: bank[1], ifsc: bank[2], pan: bank[3] } });
    }
  }

  // Accounts
  await prisma.accountCategory.createMany({ data: DEFAULT_ACCOUNT_CATEGORIES.map((c) => ({ ...c, schoolId })), skipDuplicates: true });
  const cats = await prisma.accountCategory.findMany({ where: { schoolId } });
  for (const t of TXNS) {
    const category = cats.find((c) => c.name === t.category && c.type === t.type);
    const exists = await prisma.transaction.findFirst({ where: { schoolId, date: d(t.date), party: t.party, amount: t.rupees * 100 } });
    if (exists || !category) continue;
    await prisma.transaction.create({
      data: {
        schoolId,
        date: d(t.date),
        type: t.type,
        categoryId: category.id,
        amount: t.rupees * 100,
        mode: t.mode,
        party: t.party,
        description: t.description ?? null,
        reference: t.reference ?? null,
        createdById: principal?.id ?? null,
      },
    });
  }

  // Inventory
  for (const it of ITEMS) {
    if (await prisma.inventoryItem.findFirst({ where: { schoolId, name: it.name } })) continue;
    const issued = (it.issued ?? []).reduce((n, [q]) => n + q, 0);
    const item = await prisma.inventoryItem.create({
      data: { schoolId, name: it.name, category: it.category, unit: it.unit, minStock: it.minStock, rate: it.rupees * 100, stock: it.opening - issued },
    });
    await prisma.stockMovement.create({
      data: { schoolId, itemId: item.id, type: 'IN', quantity: it.opening, date: d('2026-07-01'), rate: it.rupees * 100, party: 'Sharma Book Depot', remark: 'Opening stock', createdById: principal?.id ?? null },
    });
    for (const [i, [q, to]] of (it.issued ?? []).entries()) {
      await prisma.stockMovement.create({
        data: { schoolId, itemId: item.id, type: 'OUT', quantity: q, date: d(i ? '2026-11-02' : '2026-09-01'), party: to, createdById: principal?.id ?? null },
      });
    }
  }
}
