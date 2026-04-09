import { Router } from 'express';
import { config } from '../config.js';
import {
  getPreSessionBriefWithAutoRefresh,
  refreshPreSessionBrief,
} from '../preSessionWorker.js';
import { query } from '../db/mysql.js';

export const preSessionBriefRouter = Router();

function requireAuth(req, res, next) {
  if (!config.internalApiSecret) return next();
  const h = req.headers.authorization || '';
  if (h !== `Bearer ${config.internalApiSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

async function verifyTeacherOwnsClass(req, res, next) {
  const tid = req.headers['x-teacher-id'];
  if (!tid) return next();
  const teacherId = Number(tid);
  const classId = Number(req.params.classId);
  if (!Number.isFinite(teacherId) || !Number.isFinite(classId)) {
    return res.status(400).json({ error: 'Invalid teacher/class id' });
  }
  const rows = await query(
    `SELECT 1 AS ok
     FROM classes
     WHERE id = :classId
       AND teacher_id = :teacherId
     LIMIT 1`,
    { classId, teacherId },
  );
  if (!rows?.length) {
    return res.status(403).json({ error: 'Teacher has no access to this class' });
  }
  return next();
}

preSessionBriefRouter.get(
  '/v1/teachers/classes/:classId/pre-session-brief',
  requireAuth,
  verifyTeacherOwnsClass,
  async (req, res) => {
    try {
      const classId = Number(req.params.classId);
      if (!Number.isFinite(classId) || classId <= 0) {
        return res.status(400).json({ error: 'Invalid classId' });
      }
      const payload = await getPreSessionBriefWithAutoRefresh(classId);
      return res.json(payload);
    } catch (err) {
      return res.status(500).json({ error: err?.message || 'Failed to load pre-session brief' });
    }
  },
);

preSessionBriefRouter.post(
  '/v1/teachers/classes/:classId/pre-session-brief/refresh',
  requireAuth,
  verifyTeacherOwnsClass,
  async (req, res) => {
    try {
      const classId = Number(req.params.classId);
      if (!Number.isFinite(classId) || classId <= 0) {
        return res.status(400).json({ error: 'Invalid classId' });
      }
      const payload = await refreshPreSessionBrief(classId, { force: true });
      return res.json(payload);
    } catch (err) {
      return res.status(500).json({ error: err?.message || 'Failed to refresh pre-session brief' });
    }
  },
);
