// Runtime configuration. Everything runs in the browser; there is no server.
export const config = Object.freeze({
  appVersion: '1.0.0',
  pageSize: 60,
  largeFileBytes: 3 * 1024 * 1024,
  backupReminderDays: 30,
});
