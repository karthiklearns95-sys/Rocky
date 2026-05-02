import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  const client = new GoogleGenAI({ apiKey });
  
  try {
    const models = await client.models.list();
    console.log('Available Models:', models.map(m => m.name));
  } catch (err) {
    console.error('FAILED TO LIST:', err.message || err);
  }
}

test();
