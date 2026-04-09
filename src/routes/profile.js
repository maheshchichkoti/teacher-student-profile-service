import { Router } from 'express';
import { config } from '../config.js';
import { query } from '../db/mysql.js';
import { ensureSnapshotRow, getSnapshot, parseSnapshotRow } from '../snapshotRepo.js';
import { refreshStudentProfile } from '../worker.js';
import {
  summaryDisplayFromRow,
  weakWordsForApi,
} from '../profileApiShape.js';

export const profileRouter = Router();

function requireAuth(req, res, next) {
  if (!config.internalApiSecret) return next();
  const h = req.headers.authorization || '';
  if (!h || h !== `Bearer ${config.internalApiSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

async function verifyTeacherOwnsStudent(req, res, next) {
  const tid = req.headers['x-teacher-id'];
  if (!tid) return next();
  const studentId = Number(req.params.studentId);
  const teacherId = Number(tid);
  if (!Number.isFinite(studentId) || !Number.isFinite(teacherId)) {
    return res.status(400).json({ error: 'Invalid ids' });
  }
  const rows = await query(
    `SELECT 1 AS ok
     FROM classes
     WHERE student_id = :sid AND teacher_id = :tid
     LIMIT 1`,
    { sid: studentId, tid: teacherId },
  );
  if (!rows?.length) {
    return res.status(403).json({ error: 'Teacher has no classes with this student' });
  }
  return next();
}

function mapRowToApi(row) {
  const r = parseSnapshotRow(row);
  if (!r) {
    return {
      studentId: null,
      metricsStatus: 'pending',
      summaryStatus: 'pending',
      englishLevel: null,
      totalWordsLearned: 0,
      weakWords: [],
      grammarTopics: [],
      totalClasses: 0,
      learningGoal: null,
      aiSummary: null,
      summaryDisplay: 'Generating summary...',
      lastAnalysisAt: null,
      metricsUpdatedAt: null,
      summaryUpdatedAt: null,
    };
  }
  return {
    studentId: r.studentId,
    metricsStatus: r.metricsStatus || 'pending',
    summaryStatus: r.summaryStatus || 'pending',
    englishLevel: r.englishLevel,
    totalWordsLearned: Number(r.totalWordsLearned || 0),
    weakWords: weakWordsForApi(r.weakWords),
    grammarTopics: r.grammarTopics,
    totalClasses: Number(r.totalClasses || 0),
    learningGoal: r.learningGoal,
    aiSummary: (r.summaryStatus || 'pending') === 'ready' ? r.aiSummary : null,
    summaryDisplay: summaryDisplayFromRow(r),
    lastAnalysisAt: r.lastAnalysisAt
      ? new Date(r.lastAnalysisAt).toISOString()
      : null,
    metricsUpdatedAt: r.metricsUpdatedAt
      ? new Date(r.metricsUpdatedAt).toISOString()
      : null,
    summaryUpdatedAt: r.summaryUpdatedAt
      ? new Date(r.summaryUpdatedAt).toISOString()
      : null,
  };
}

profileRouter.get(
  '/v1/teachers/students/:studentId/profile',
  requireAuth,
  verifyTeacherOwnsStudent,
  async (req, res) => {
    try {
      const studentId = Number(req.params.studentId);
      if (!Number.isFinite(studentId) || studentId <= 0) {
        return res.status(400).json({ error: 'Invalid studentId' });
      }

      console.log('[profile] request', {
        studentId,
        teacherId: req.headers['x-teacher-id'] || null,
      });

      await ensureSnapshotRow(studentId);
      let row = await getSnapshot(studentId);
      const staleMs = config.metricsStaleAfterSec * 1000;
      const mtime = row?.metricsUpdatedAt
        ? new Date(row.metricsUpdatedAt).getTime()
        : 0;
      const metricsStatus = row?.metricsStatus || 'pending';
      const genStuck =
        metricsStatus === 'generating' &&
        row?.updatedAt &&
        Date.now() - new Date(row.updatedAt).getTime() > 180_000;
      const needsRefresh =
        ['pending', 'failed'].includes(metricsStatus) ||
        genStuck ||
        (metricsStatus !== 'generating' &&
          (!Number.isFinite(mtime) || Date.now() - mtime > staleMs));

      if (needsRefresh) {
        setImmediate(() => {
          refreshStudentProfile(studentId).catch((err) => {
            console.error('[profile] background refresh failed', {
              studentId,
              message: err?.message,
              stack: err?.stack,
            });
          });
        });
      }

      row = await getSnapshot(studentId);
      const payload = mapRowToApi(row);

      console.log('[profile] success', {
        studentId,
        metricsStatus: payload.metricsStatus,
        summaryStatus: payload.summaryStatus,
        totalClasses: payload.totalClasses,
      });

      return res.json(payload);
    } catch (e) {
      console.error('[profile] failed', {
        studentId: req.params.studentId,
        teacherId: req.headers['x-teacher-id'] || null,
        message: e?.message,
        stack: e?.stack,
      });
      return res.status(500).json({
        error: e?.message || 'Failed to load profile',
      });
    }
  },
);

profileRouter.post(
  '/v1/teachers/students/:studentId/profile/refresh',
  requireAuth,
  verifyTeacherOwnsStudent,
  async (req, res) => {
    try {
      const studentId = Number(req.params.studentId);
      if (!Number.isFinite(studentId) || studentId <= 0) {
        return res.status(400).json({ error: 'Invalid studentId' });
      }
      const skipLlm = req.query.skipLlm === '1' || req.query.skipLlm === 'true';

      console.log('[profile/refresh] request', {
        studentId,
        teacherId: req.headers['x-teacher-id'] || null,
        skipLlm,
      });

      const result = await refreshStudentProfile(studentId, { skipLlm });
      const payload = mapRowToApi(result);

      console.log('[profile/refresh] success', {
        studentId,
        metricsStatus: payload.metricsStatus,
        summaryStatus: payload.summaryStatus,
        totalClasses: payload.totalClasses,
      });

      return res.json(payload);
    } catch (e) {
      console.error('[profile/refresh] failed', {
        studentId: req.params.studentId,
        teacherId: req.headers['x-teacher-id'] || null,
        skipLlm: req.query.skipLlm,
        message: e?.message,
        stack: e?.stack,
      });
      return res.status(500).json({
        error: e.message || 'Refresh failed',
      });
    }
  },
);
