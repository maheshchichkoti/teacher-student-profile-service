import { refreshStudentProfile } from './worker.js';

const sid = Number(process.argv[2]);
if (!Number.isFinite(sid) || sid <= 0) {
  console.error('Usage: node src/cli-worker-once.js <studentId> [--skip-llm]');
  process.exit(1);
}
const skipLlm = process.argv.includes('--skip-llm');

refreshStudentProfile(sid, { skipLlm })
  .then((row) => {
    console.log(JSON.stringify(row, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
