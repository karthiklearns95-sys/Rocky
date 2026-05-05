import * as lancedb from '@lancedb/lancedb';
import path from 'path';

async function checkMemory() {
  const dbPath = path.resolve('data/lancedb');
  try {
    const db = await lancedb.connect(dbPath);
    const table = await db.openTable('memory');
    const results = await table.query().limit(10).execute();
    console.log("Memory Contents:");
    console.log(JSON.stringify(results, null, 2));
  } catch (e) {
    console.error("Error reading LanceDB:", e.message);
  }
}

checkMemory();
