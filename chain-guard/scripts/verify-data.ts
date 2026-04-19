import { client, initReportsDatabase } from '../src/db/setup';

await initReportsDatabase();

const reports = await client.execute('SELECT id, upi_id, SUBSTR(markdown_result, 1, 100) as preview, created_at FROM reports');
console.log('Reports:', reports.rows);

const upi = await client.execute('SELECT * FROM upi_status');
console.log('\nUPI Status:', upi.rows);