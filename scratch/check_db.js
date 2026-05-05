import Database from 'better-sqlite3';
const db = new Database('data/rocky_memory.db');
const facts = db.prepare('SELECT * FROM user_facts').all();
console.log(JSON.stringify(facts, null, 2));
