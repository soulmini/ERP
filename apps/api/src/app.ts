import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './env';
import { requireAuth } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './modules/auth';
import { schoolRouter } from './modules/school';
import { academicRouter } from './modules/academic';
import { usersRouter } from './modules/users';
import { studentsRouter } from './modules/students';
import { attendanceRouter } from './modules/attendance';
import { parentRouter } from './modules/parent';
import { dashboardRouter } from './modules/dashboard';
import { admissionsRouter } from './modules/admissions';
import { feesRouter } from './modules/fees';
import { homeworkRouter } from './modules/homework';
import { noticesRouter } from './modules/notices';
import { timetableRouter } from './modules/timetable';
import { examsRouter } from './modules/exams';
import { certificatesRouter } from './modules/certificates';
import { payrollRouter } from './modules/payroll';
import { accountsRouter } from './modules/accounts';
import { inventoryRouter } from './modules/inventory';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      // Web app domain(s) + Capacitor app origins. Set CORS_ORIGINS on the server.
      origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.use('/api/auth', authRouter);

  const api = express.Router();
  api.use(requireAuth);
  api.use('/school', schoolRouter);
  api.use('/academic', academicRouter);
  api.use('/users', usersRouter);
  api.use('/students', studentsRouter);
  api.use('/attendance', attendanceRouter);
  api.use('/parent', parentRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/admissions', admissionsRouter);
  api.use('/fees', feesRouter);
  api.use('/homework', homeworkRouter);
  api.use('/notices', noticesRouter);
  api.use('/timetable', timetableRouter);
  api.use('/exams', examsRouter);
  api.use('/certificates', certificatesRouter);
  api.use('/payroll', payrollRouter);
  api.use('/accounts', accountsRouter);
  api.use('/inventory', inventoryRouter);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
