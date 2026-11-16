import { Router } from 'express';
import { registerSetupRoutes } from './setup';
import { registerMarksRoutes } from './marks';
import { registerReportRoutes } from './reports';

/**
 * Exams: exams of the session, date sheets, grade scale, marks entry, class-teacher remarks,
 * result sheets, report cards and admit cards (staff + parent).
 * Permissions: exams.manage (setup, publish, everything); marks.enter (teachers: own class / own subjects).
 * Parents reach /exams/child/:studentId and the report-card / admit-card endpoints for their own children.
 */
export const examsRouter = Router();
registerReportRoutes(examsRouter);
registerSetupRoutes(examsRouter);
registerMarksRoutes(examsRouter);
