import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { descriptor } = await request.json();
    
    if (!descriptor || !Array.isArray(descriptor) || descriptor.length !== 128) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid face descriptor. Must be a 128-dimensional array of numbers.' 
      }, { status: 400 });
    }

    const db = getDb();
    
    // We execute an L2 (Euclidean) distance matching query on PostgreSQL
    // by unnesting the descriptor array and the input query array side-by-side,
    // joining on their index (ORDINALITY), summing the squared differences, and limiting to the top match.
    const queryText = `
      SELECT id, name, 
        (
          SELECT SUM((a - b)^2) 
          FROM unnest(descriptor) WITH ORDINALITY AS x(a, i) 
          JOIN unnest($1::double precision[]) WITH ORDINALITY AS y(b, j) 
          ON x.i = y.j
        ) as distance_sq
      FROM registered_faces
      ORDER BY distance_sq ASC
      LIMIT 1
    `;
    
    const result = await db.query(queryText, [descriptor]);
    
    if (result.rows.length === 0) {
      return NextResponse.json({
        success: true,
        match: false,
        message: 'No registered faces found in the database.'
      });
    }
    
    const bestMatch = result.rows[0];
    const distanceSq = parseFloat(bestMatch.distance_sq);
    const distance = Math.sqrt(distanceSq);
    
    // Standard L2 threshold for face-api.js is 0.6.
    // If distance is less than 0.6, it is a match.
    const isMatch = distance < 0.6;
    
    // Calculate a confidence percentage:
    // 0 distance = 100% confidence, 0.6 distance (limit) = 0% confidence relative to threshold,
    // or absolute similarity: (1 - distance) * 100. Let's do absolute similarity but capped.
    const similarity = Math.max(0, Math.min(1, 1 - distance));
    const confidence = Math.round(similarity * 100);
    
    return NextResponse.json({
      success: true,
      match: isMatch,
      matchedUser: isMatch ? {
        id: bestMatch.id,
        name: bestMatch.name,
        distance: distance,
        confidence: confidence
      } : null,
      debug: {
        rawClosestName: bestMatch.name,
        rawDistance: distance
      }
    });
  } catch (error) {
    console.error('Recognition API error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
