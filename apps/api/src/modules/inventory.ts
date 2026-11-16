import { Router } from 'express';
import { inventoryItemSchema, stockAdjustSchema, stockInSchema, stockOutSchema } from '@erp/shared';
import { prisma } from '../db';
import type { Prisma } from '../generated/prisma/client';
import { badRequest, conflict, notFound, optStr, parse, str } from '../lib/http';
import { dateOnly, toDateStr, todayStr } from '../lib/dates';
import { audit } from '../lib/audit';
import { authOf, can } from '../middleware/auth';

/** Inventory items and stock movements. */
export const inventoryRouter = Router();
inventoryRouter.use(can('inventory.manage'));

const presentItem = (i: { stock: number; minStock: number; rate: number | null }) => ({
  value: i.rate != null ? i.stock * i.rate : null,
  low: i.stock <= i.minStock,
});

inventoryRouter.get('/items', async (req, res) => {
  const { sid } = authOf(req);
  const search = optStr(req.query.search)?.trim();
  const category = optStr(req.query.category);
  const where: Prisma.InventoryItemWhereInput = {
    schoolId: sid,
    ...(req.query.inactive === '1' ? {} : { isActive: true }),
    ...(category ? { category } : {}),
    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
  };
  const items = await prisma.inventoryItem.findMany({ where, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  const rows = items.map((i) => ({ ...i, ...presentItem(i) })).filter((i) => req.query.low !== '1' || i.low);
  const active = items.filter((i) => i.isActive);
  const categories = await prisma.inventoryItem.findMany({
    where: { schoolId: sid, category: { not: null } },
    distinct: ['category'],
    select: { category: true },
  });
  res.json({
    items: rows,
    categories: categories.map((c) => c.category!).sort(),
    stats: {
      items: active.length,
      lowStock: active.filter((i) => i.stock <= i.minStock).length,
      totalValue: active.reduce((n, i) => n + (i.rate != null ? i.stock * i.rate : 0), 0),
    },
  });
});

inventoryRouter.post('/items', async (req, res) => {
  const a = authOf(req);
  const { openingStock, ...input } = parse(inventoryItemSchema, req.body);
  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.inventoryItem.create({ data: { ...input, rate: input.rate ?? null, schoolId: a.sid, stock: openingStock ?? 0 } });
    if (openingStock) {
      await tx.stockMovement.create({
        data: {
          schoolId: a.sid,
          itemId: created.id,
          type: 'IN',
          quantity: openingStock,
          date: dateOnly(todayStr()),
          rate: input.rate ?? null,
          remark: 'Opening stock',
          createdById: a.sub,
        },
      });
    }
    return created;
  });
  audit(req, 'inventory.item.create', 'InventoryItem', item.id);
  res.status(201).json(item);
});

inventoryRouter.put('/items/:id', async (req, res) => {
  const a = authOf(req);
  const { openingStock: _o, ...input } = parse(inventoryItemSchema, req.body);
  const r = await prisma.inventoryItem.updateMany({
    where: { id: str(req.params.id), schoolId: a.sid },
    data: { ...input, category: input.category ?? null, rate: input.rate ?? null },
  });
  if (!r.count) throw notFound('Item not found');
  res.json({ ok: true });
});

inventoryRouter.delete('/items/:id', async (req, res) => {
  const a = authOf(req);
  const item = await prisma.inventoryItem.findFirst({ where: { id: str(req.params.id), schoolId: a.sid }, include: { _count: { select: { movements: true } } } });
  if (!item) throw notFound('Item not found');
  // Only an item with no history beyond its opening stock can be deleted.
  if (item._count.movements > 1) {
    throw conflict('This item has stock history. Mark it inactive instead of deleting.');
  }
  await prisma.inventoryItem.delete({ where: { id: item.id } });
  res.json({ ok: true });
});

inventoryRouter.get('/items/:id', async (req, res) => {
  const a = authOf(req);
  const item = await prisma.inventoryItem.findFirst({
    where: { id: str(req.params.id), schoolId: a.sid },
    include: { movements: { orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200 } },
  });
  if (!item) throw notFound('Item not found');
  const { movements, ...rest } = item;
  res.json({ ...rest, ...presentItem(item), movements: movements.map((m) => ({ ...m, date: toDateStr(m.date) })) });
});

/** Change stock atomically; refuses to go below zero even under concurrent requests. */
async function move(
  schoolId: string,
  userId: string,
  itemId: string,
  type: 'IN' | 'OUT' | 'ADJUST',
  delta: number,
  data: { date: string; rate?: number | null; party?: string; remark?: string },
) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.inventoryItem.findFirst({ where: { id: itemId, schoolId } });
    if (!item) throw notFound('Item not found');
    const r =
      delta >= 0
        ? await tx.inventoryItem.updateMany({
            where: { id: itemId },
            data: { stock: { increment: delta }, ...(type === 'IN' && data.rate != null ? { rate: data.rate } : {}) },
          })
        : await tx.inventoryItem.updateMany({ where: { id: itemId, stock: { gte: -delta } }, data: { stock: { decrement: -delta } } });
    if (!r.count) throw badRequest(`Only ${item.stock} ${item.unit} in stock`);
    await tx.stockMovement.create({
      data: {
        schoolId,
        itemId,
        type,
        quantity: type === 'ADJUST' ? delta : Math.abs(delta),
        date: dateOnly(data.date),
        rate: data.rate ?? null,
        party: data.party ?? null,
        remark: data.remark ?? null,
        createdById: userId,
      },
    });
    return tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
  });
}

inventoryRouter.post('/items/:id/in', async (req, res) => {
  const a = authOf(req);
  const input = parse(stockInSchema, req.body);
  const item = await move(a.sid, a.sub, str(req.params.id), 'IN', input.quantity, input);
  audit(req, 'inventory.in', 'InventoryItem', item.id, { quantity: input.quantity });
  res.json(item);
});

inventoryRouter.post('/items/:id/out', async (req, res) => {
  const a = authOf(req);
  const input = parse(stockOutSchema, req.body);
  const item = await move(a.sid, a.sub, str(req.params.id), 'OUT', -input.quantity, input);
  audit(req, 'inventory.out', 'InventoryItem', item.id, { quantity: input.quantity, to: input.party });
  res.json(item);
});

inventoryRouter.post('/items/:id/adjust', async (req, res) => {
  const a = authOf(req);
  const input = parse(stockAdjustSchema, req.body);
  const item = await move(a.sid, a.sub, str(req.params.id), 'ADJUST', input.quantity, input);
  audit(req, 'inventory.adjust', 'InventoryItem', item.id, { quantity: input.quantity });
  res.json(item);
});
