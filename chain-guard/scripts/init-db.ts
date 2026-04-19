import { initReportsDatabase } from '../src/db/setup';

await initReportsDatabase();
console.log('Done!');