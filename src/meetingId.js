/**
 * Normalize Zoom numeric meeting id for Postgres joins (teacher-intelligence plan).
 * Prefer classes.zoom_meeting_id; else extract digits from admin_url / join_url /j/<id>.
 * @param {string|null|undefined} zoomMeetingId
 * @param {string|null|undefined} adminUrl
 * @param {string|null|undefined} joinUrl
 * @returns {string|null}
 */
export function normalizeZoomMeetingId(zoomMeetingId, adminUrl, joinUrl) {
  const z = zoomMeetingId != null ? String(zoomMeetingId).trim() : '';
  if (z && /^\d+$/.test(z)) return z;

  const fromUrl = (url) => {
    if (!url) return null;
    const m = String(url).match(/\/j\/(\d+)/i);
    return m ? m[1] : null;
  };

  return fromUrl(adminUrl) || fromUrl(joinUrl) || null;
}
