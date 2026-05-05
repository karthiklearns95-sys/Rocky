import sendEmailDirect from '../tools/system/sendEmailDirect.js';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  console.log("Testing email with new credentials...");
  const result = await sendEmailDirect({
    recipient: 'karthikeyalearns95@gmail.com',
    subject: 'Rocky Connection Test',
    body: 'Grace, the connection is established. Rocky is online and calibrated.'
  });
  console.log("Result:", result);
}

test();
