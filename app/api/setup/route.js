import { initDb } from '@/lib/db';
import { NextResponse } from 'next/server';

// Force dynamic execution so it is not statically generated at build time
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await initDb();
    return NextResponse.json({ success: true, message: 'Database initialized successfully.' });
  } catch (error) {
    console.error('Database setup error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
