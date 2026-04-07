import { Router } from 'express';
import { query } from '../db/mysql.js';

export const myStudentsDemoRouter = Router();

const studentLevels = {
  1: 'Pre basic 1',
  2: 'Basic user A1',
  3: 'High basic user A1',
  4: 'Low basic user A2',
  5: 'Basic user A2',
  6: 'High basic user A2',
  7: 'Low independent user B1',
  8: 'Independent user B1',
  9: 'High independent user B1',
  10: 'Low independent user B2',
  11: 'Independent user B2',
  12: 'High independent user B2',
  13: 'Advanced C1',
  14: 'Superior Advanced C1',
  15: 'Highly Advanced C1',
};

function mapStudentLevel(rawLevel) {
  if (rawLevel == null) return null;
  const v = String(rawLevel).trim();
  if (!v) return null;
  const n = Number(v);
  if (Number.isInteger(n) && studentLevels[n]) return studentLevels[n];
  return v;
}

function coercePositiveInt(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function safeSort(sortBy) {
  switch (sortBy) {
    case 'name':
      return 'studentName';
    case 'level':
      return 'level';
    case 'totalClasses':
      return 'totalClasses';
    case 'learningHours':
      return 'learningMinutes';
    case 'lastClass':
      return 'lastClassDate';
    default:
      return 'studentName';
  }
}

function safeOrder(sortOrder) {
  return sortOrder === 'asc' ? 'ASC' : 'DESC';
}

/**
 * Demo endpoint to populate the student list page.
 * This intentionally avoids any auth (demo-only UI); it derives data from MySQL
 * `classes` + `users` using tolerant column selection.
 */
myStudentsDemoRouter.get('/demo/my-students', async (req, res) => {
  try {
    const page = coercePositiveInt(req.query.page, 1);
    const limit = Math.min(coercePositiveInt(req.query.limit, 10), 50);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();

    const sortBy = safeSort(String(req.query.sortBy || 'name'));
    const sortOrder = safeOrder(String(req.query.sortOrder || 'desc'));
    const startedAt = Date.now();

    console.log('[demo/my-students] request', {
      page,
      limit,
      search,
      sortBy,
      sortOrder,
      status: String(req.query.status || '').trim(),
    });

    // Filters from main app exist, but this demo implements only status/search.
    const status = String(req.query.status || '').trim();

    const where = [];
    const params = {};

    // Active students heuristic (same idea as snapshot totalClasses): ended + present.
    where.push(`c.status = 'ended' AND c.is_present = 1`);

    // If status is requested, we can only approximate. Keep "active" as default (no-op).
    if (status && status !== 'active') {
      // Demo: no data source for transferred/canceled; return empty for non-active filters.
      return res.json({
        pagination: {
          currentPage: page,
          totalPages: 1,
          totalStudents: 0,
          itemsPerPage: limit,
          hasNextPage: false,
          hasPreviousPage: page > 1,
        },
        students: [],
        metrics: {
          totalStudents: 0,
          activeStudents: 0,
          atRiskStudents: 0,
          newStudentsThisMonth: 0,
          uniqueStudentsPerDay: 0,
          uniqueStudentsPerDayChange: 0,
          averageClassesPerDay: 0,
          averageClassesPerDayChange: 0,
          averageClassesLast7Days: 0,
          averageUniqueStudentsLast7Days: 0,
        },
      });
    }

    if (search) {
      params.q = `%${search}%`;
      where.push(`(
        COALESCE(NULLIF(TRIM(u.full_name), ''), '') LIKE :q
        OR COALESCE(NULLIF(TRIM(u.email), ''), '') LIKE :q
      )`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // Total distinct students for pagination.
    const [countRow] = await query(
      `SELECT COUNT(DISTINCT c.student_id) AS total
       FROM classes c
       LEFT JOIN users u ON u.id = c.student_id
       ${whereSql}`,
      params,
    );
    const totalStudents = Number(countRow?.total || 0);
    const totalPages = Math.max(1, Math.ceil(totalStudents / limit));

    // Aggregate per student.
    // Notes:
    // - totalClasses uses ended + present heuristic (same as snapshot metrics).
    // - learningMinutes uses meeting_start/end when present; otherwise 0.
    // - lastClassDate uses last ended+present class; nextClassDate uses future meeting_start when available.
    const rows = await query(
      `SELECT
        c.student_id AS studentId,
        COALESCE(
          NULLIF(TRIM(u.full_name), ''),
          CONCAT('Student ', c.student_id)
        ) AS studentName,
        COALESCE(NULLIF(TRIM(u.avatar), ''), '') AS avatar,
        u.age AS age,
        NULLIF(TRIM(CAST(u.student_level AS CHAR)), '') AS level,
        SUM(CASE WHEN c.status = 'ended' AND c.is_present = 1 THEN 1 ELSE 0 END) AS totalClasses,
        SUM(
          CASE
            WHEN c.status = 'ended' AND c.is_present = 1 AND c.meeting_start IS NOT NULL AND c.meeting_end IS NOT NULL
              THEN TIMESTAMPDIFF(MINUTE, c.meeting_start, c.meeting_end)
            ELSE 0
          END
        ) AS learningMinutes,
        MAX(CASE WHEN c.status = 'ended' AND c.is_present = 1 THEN c.meeting_start ELSE NULL END) AS lastClassDate,
        MIN(CASE WHEN c.meeting_start > NOW() THEN c.meeting_start ELSE NULL END) AS nextClassDate
     FROM classes c
     LEFT JOIN users u ON u.id = c.student_id
     ${whereSql}
     GROUP BY c.student_id
     ORDER BY ${sortBy} ${sortOrder}
     LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    const nowMs = Date.now();
    const students = rows.map((r) => {
      const last = r.lastClassDate ? new Date(r.lastClassDate) : null;
      const next = r.nextClassDate ? new Date(r.nextClassDate) : null;
      const lastDays =
        last && Number.isFinite(last.getTime())
          ? Math.max(0, Math.floor((nowMs - last.getTime()) / 86400000))
          : null;

      const learningMinutes = Number(r.learningMinutes || 0);
      const learningHours = Number.isFinite(learningMinutes)
        ? Math.round((learningMinutes / 60) * 10) / 10
        : 0;

      return {
        subscriptionDurationDays: null,
        id: String(r.studentId),
        name: String(r.studentName || `Student ${r.studentId}`),
        avatar: String(r.avatar || ''),
        age: r.age != null && Number.isFinite(Number(r.age)) ? Number(r.age) : null,
        level: mapStudentLevel(r.level),
        status: 'active',
        totalClasses: Number(r.totalClasses || 0),
        learningHours: {
          withYou: learningHours,
          withOthers: 0,
          total: learningHours,
        },
        lastClassDays: lastDays,
        lastClassDate: last ? last.toISOString() : null,
        nextClassDate: next ? next.toISOString() : null,
        subscriptionStatus: null,
        subscriptionRenewal: null,
        subscriptionProgress: null,
        subscriptionDetails: null,
        daysUntilRenewal: null,
        regularClasses: null,
      };
    });

    console.log('[demo/my-students] success', {
      totalStudents,
      returnedStudents: students.length,
      durationMs: Date.now() - startedAt,
    });

    return res.json({
      pagination: {
        currentPage: page,
        totalPages,
        totalStudents,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      students,
      metrics: {
        totalStudents,
        activeStudents: totalStudents,
        atRiskStudents: 0,
        newStudentsThisMonth: 0,
        uniqueStudentsPerDay: 0,
        uniqueStudentsPerDayChange: 0,
        averageClassesPerDay: 0,
        averageClassesPerDayChange: 0,
        averageClassesLast7Days: 0,
        averageUniqueStudentsLast7Days: 0,
      },
    });
  } catch (e) {
    console.error('[demo/my-students] failed', {
      query: req.query,
      message: e?.message,
      code: e?.code,
      sqlMessage: e?.sqlMessage,
      stack: e?.stack,
    });
    return res.status(500).json({
      error: e?.message || 'Failed to load students',
    });
  }
});
