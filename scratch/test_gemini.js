import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log('Using Key:', apiKey.substring(0, 10) + '...');
  const client = new GoogleGenAI({ apiKey });
  
  try {
    const result = await client.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'Say "Hello"' }] }]
    });
    console.log('SUCCESS:', result.text);
  } catch (err) {
    console.error('FAILED:', err.message || err);
  }
}

test();
