import { queryPg } from './db/postgres.js';

const CRM_TABLE_EXISTS_SQL = `
SELECT EXISTS (
  SELECT 1
  FROM information_schema.tables
  WHERE table_schema = 'raw'
    AND table_name = 'class_recording_matches'
) AS present
`;

const CRM_SESSION_ENRICHMENT_SQL = `
SELECT
  z.llm_response_raw AS llm_response_raw,
  r.parsed_response AS parsed_response,
  z.recording_start AS recording_start
FROM raw.class_recording_matches crm
LEFT JOIN raw.zoom_webhook_request z
  ON z.id = crm.recording_id
LEFT JOIN raw.llm_intake_queue i
  ON (
       z.audio_url IS NOT NULL
   AND i.audio_url IS NOT NULL
   AND z.audio_url = i.audio_url
  )
   OR (
       z.meeting_id = i.zoom_meeting_id
   AND i.created_at BETWEEN z.recording_start - INTERVAL '15 minutes'
                        AND z.recording_end + INTERVAL '1 hour'
  )
LEFT JOIN raw.llm_responses r
  ON i.request_id = r.request_id
WHERE (crm.mysql_class_id = $1::text OR crm.staging_class_key = $1::text)
  AND crm.recording_id IS NOT NULL
ORDER BY
  CASE WHEN r.parsed_response IS NOT NULL THEN 0 ELSE 1 END,
  i.created_at DESC NULLS LAST,
  z.recording_start DESC NULLS LAST
LIMIT 1
`;

/** Same join as docs/plans/2026-04-02-ai-teacher-intelligence-separate-repo.md Query B. */
const SESSION_ENRICHMENT_SQL = `
SELECT
  z.llm_response_raw AS llm_response_raw,
  r.parsed_response AS parsed_response,
  z.recording_start AS recording_start
FROM raw.zoom_webhook_request z
LEFT JOIN raw.llm_intake_queue i
  ON z.meeting_id = i.zoom_meeting_id
 AND i.created_at BETWEEN z.recording_start AND z.recording_end + INTERVAL '1 hour'
LEFT JOIN raw.llm_responses r
  ON i.request_id = r.request_id
WHERE z.meeting_id = $1
  AND z.recording_start BETWEEN $2::timestamptz - INTERVAL '30 minutes'
                            AND $3::timestamptz + INTERVAL '30 minutes'
-- Meeting links/IDs can be reused; prefer the closest recording_start to class start.
ORDER BY ABS(EXTRACT(EPOCH FROM (z.recording_start - $2::timestamptz))) ASC
LIMIT 1
`;

let crmTableExistsPromise;

async function hasClassRecordingMatchesTable() {
  if (!crmTableExistsPromise) {
    crmTableExistsPromise = queryPg(CRM_TABLE_EXISTS_SQL)
      .then((rows) => Boolean(rows[0]?.present))
      .catch(() => false);
  }
  return crmTableExistsPromise;
}

/**
 * @param {number|string|null|undefined} classId
 * @param {string} meetingId digits only
 * @param {Date|string} meetingStart
 * @param {Date|string|null} meetingEnd
 */
export async function fetchSessionEnrichment(classId, meetingId, meetingStart, meetingEnd) {
  const start =
    meetingStart instanceof Date ? meetingStart.toISOString() : new Date(meetingStart).toISOString();
  let end;
  if (meetingEnd) {
    end = meetingEnd instanceof Date ? meetingEnd.toISOString() : new Date(meetingEnd).toISOString();
  } else {
    end = new Date(new Date(start).getTime() + 2 * 60 * 60 * 1000).toISOString();
  }

  const classKey = classId == null ? '' : String(classId).trim();
  if (classKey && (await hasClassRecordingMatchesTable())) {
    const crmRows = await queryPg(CRM_SESSION_ENRICHMENT_SQL, [classKey]);
    if (crmRows[0]) return crmRows[0];
  }

  const rows = await queryPg(SESSION_ENRICHMENT_SQL, [meetingId, start, end]);
  return rows[0] || null;
}
