import { Router } from 'express';
import { feesSetupRouter } from './fees/setup';
import { feesCollectRouter } from './fees/collect';
import { feesReportsRouter } from './fees/reports';

/**
 * Fees: heads, structures, concessions, dues, collection, receipts, reports, parent view.
 * Permissions: fees.view (see fees / reports), fees.collect (collect + receipts),
 * fees.manage (heads, structure, concessions, generate dues, waive, cancel receipts).
 * Parents reach /fees/parent/* and their children's receipts only.
 */
export const feesRouter = Router();
feesRouter.use(feesReportsRouter);
feesRouter.use(feesSetupRouter);
feesRouter.use(feesCollectRouter);
