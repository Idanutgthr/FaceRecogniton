import { createPool } from '@vercel/postgres';

let pool;

export function getDb() {
  if (!pool) {
    // createPool automatically reads POSTGRES_URL or POSTGRES_PRISMA_URL from env.
    pool = createPool();
  }
  return pool;
}

export async function initDb() {
  const db = getDb();
  
  // Create table if it doesn't exist
  // We use double precision[] to store the 128-dimensional floating point face descriptors.
  await db.query(`
    CREATE TABLE IF NOT EXISTS registered_faces (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      descriptor double precision[] NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  console.log('Database initialized successfully: registered_faces table is ready.');
}
