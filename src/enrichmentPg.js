import { queryPg } from './db/postgres.js';

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
ORDER BY z.recording_start DESC
LIMIT 1
`;

/**
 * @param {string} meetingId digits only
 * @param {Date|string} meetingStart
 * @param {Date|string|null} meetingEnd
 */
export async function fetchSessionEnrichment(meetingId, meetingStart, meetingEnd) {
  const start =
    meetingStart instanceof Date ? meetingStart.toISOString() : new Date(meetingStart).toISOString();
  let end;
  if (meetingEnd) {
    end = meetingEnd instanceof Date ? meetingEnd.toISOString() : new Date(meetingEnd).toISOString();
  } else {
    end = new Date(new Date(start).getTime() + 2 * 60 * 60 * 1000).toISOString();
  }
  const rows = await queryPg(SESSION_ENRICHMENT_SQL, [meetingId, start, end]);
  return rows[0] || null;
}
