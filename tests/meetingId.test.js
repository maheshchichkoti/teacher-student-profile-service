import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeZoomMeetingId } from '../src/meetingId.js';

test('uses numeric zoom_meeting_id as-is', () => {
  assert.equal(normalizeZoomMeetingId('123456789', '', ''), '123456789');
});

test('extracts id from join URL when zoom id missing', () => {
  assert.equal(
    normalizeZoomMeetingId(
      null,
      '',
      'https://zoom.us/j/9876543210?pwd=x',
    ),
    '9876543210',
  );
});

test('admin_url wins after empty zoom id', () => {
  assert.equal(
    normalizeZoomMeetingId('', 'https://us02web.zoom.us/j/555', null),
    '555',
  );
});
