import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3840),
  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'tulkka',
  },
  internalApiSecret: process.env.INTERNAL_API_SECRET || '',
  summaryTtlDays: Number(process.env.SUMMARY_TTL_DAYS || 7),
  metricsStaleAfterSec: Number(process.env.METRICS_STALE_AFTER_SEC || 900),
};
