import express from 'express';
import { config } from './config.js';
import { profileRouter } from './routes/profile.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use(profileRouter);

app.listen(config.port, () => {
  console.error(`teacher-student-profile-service listening on :${config.port}`);
});
