import { getDb, initDb } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await initDb();
    const db = getDb();
    const result = await db.query(
      'SELECT id, name, created_at FROM registered_faces ORDER BY created_at DESC'
    );
    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('List faces error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    await initDb();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'Face ID is required.' }, { status: 400 });
    }

    const db = getDb();
    const result = await db.query('DELETE FROM registered_faces WHERE id = $1 RETURNING id, name', [id]);
    
    if (result.rowCount === 0) {
      return NextResponse.json({ success: false, error: 'Face registration not found.' }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true, 
      message: `Face registration for "${result.rows[0].name}" deleted successfully.`,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Delete face error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
