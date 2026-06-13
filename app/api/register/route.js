import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { name, descriptor } = await request.json();
    
    if (!name || !name.trim()) {
      return NextResponse.json({ 
        success: false, 
        error: 'Name is required.' 
      }, { status: 400 });
    }

    if (!descriptor || !Array.isArray(descriptor) || descriptor.length !== 128) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid face descriptor. Must be a 128-dimensional array of numbers.' 
      }, { status: 400 });
    }

    const db = getDb();
    
    // Save to the database
    // The pg client maps JS arrays directly to PostgreSQL arrays
    const result = await db.query(
      'INSERT INTO registered_faces (name, descriptor) VALUES ($1, $2) RETURNING id, name, created_at',
      [name.trim(), descriptor]
    );
    
    return NextResponse.json({ 
      success: true, 
      message: 'Face registered successfully.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Registration API error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
