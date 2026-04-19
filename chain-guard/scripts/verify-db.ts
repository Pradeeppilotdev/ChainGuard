import { client } from '../src/db/setup';
const result = await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
console.log(result.rows);