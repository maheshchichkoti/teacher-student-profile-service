import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { profileRouter } from './routes/profile.js';
import { myStudentsDemoRouter } from './routes/myStudentsDemo.js';

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
  res.redirect(302, '/my-students-demo.html');
});

app.use(myStudentsDemoRouter);
app.use(profileRouter);

app.listen(config.port, () => {
  console.error(`teacher-student-profile-service listening on :${config.port}`);
});
