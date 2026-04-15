import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { profileRouter } from './routes/profile.js';
import { myStudentsDemoRouter } from './routes/myStudentsDemo.js';
import { preSessionBriefRouter } from './routes/preSessionBrief.js';
import { refreshUpcomingPreSessionBriefs } from './preSessionWorker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

/** Standalone Task 1 demo UI (main teacher app stays unchanged until approval). */
app.use(express.static(publicDir));
app.get('/', (_req, res) => {
  res.redirect(302, '/demo-home.html');
});

app.use(myStudentsDemoRouter);
app.use(profileRouter);
app.use(preSessionBriefRouter);

const server = app.listen(config.port, () => {
  console.error(`teacher-student-profile-service listening on :${config.port}`);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

if (config.preSessionSchedulerIntervalSec > 0) {
  const ms = config.preSessionSchedulerIntervalSec * 1000;
  setInterval(() => {
    refreshUpcomingPreSessionBriefs().catch((err) => {
      console.error('[pre-session] scheduler tick failed', { message: err?.message });
    });
  }, ms);

  setImmediate(() => {
    refreshUpcomingPreSessionBriefs().catch((err) => {
      console.error('[pre-session] initial scheduler run failed', { message: err?.message });
    });
  });
}
