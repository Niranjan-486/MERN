const { getQueueDate } = require('../src/utils/queueDate');

describe('getQueueDate', () => {
  test('returns YYYY-MM-DD for a given UTC date in Asia/Kolkata', () => {
    // 2026-10-06 20:00:00 UTC is 2026-10-07 01:30:00 in Asia/Kolkata (UTC + 05:30)
    const utcDate = new Date('2026-10-06T20:00:00Z');
    const kolkataDate = getQueueDate(utcDate, 'Asia/Kolkata');
    const utcFormatted = getQueueDate(utcDate, 'UTC');

    expect(utcFormatted).toBe('2026-10-06');
    expect(kolkataDate).toBe('2026-10-07');
    expect(kolkataDate).not.toBe(utcFormatted);
  });

  test('handles morning UTC time that is same day in Asia/Kolkata', () => {
    // 2026-10-06 04:00:00 UTC is 2026-10-06 09:30:00 in Asia/Kolkata
    const utcDate = new Date('2026-10-06T04:00:00Z');
    expect(getQueueDate(utcDate, 'Asia/Kolkata')).toBe('2026-10-06');
  });

  test('defaults to configured TIMEZONE when timeZone parameter is omitted', () => {
    const utcDate = new Date('2026-10-06T20:00:00Z');
    // Default in env is Asia/Kolkata
    expect(getQueueDate(utcDate)).toBe('2026-10-07');
  });

  test('handles string and numeric timestamps', () => {
    const timestamp = new Date('2026-10-06T20:00:00Z').getTime();
    expect(getQueueDate(timestamp, 'Asia/Kolkata')).toBe('2026-10-07');
    expect(getQueueDate('2026-10-06T20:00:00Z', 'Asia/Kolkata')).toBe('2026-10-07');
  });
});
