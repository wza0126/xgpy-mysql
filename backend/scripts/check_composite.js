const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.development') });
(async () => {
  const pool = mysql.createPool({host:'127.0.0.1',port:3306,user:'root',password:process.env.DB_PASSWORD || '',database:'xgpy'});
  const [rows] = await pool.query('SELECT id, type, content, answers, options FROM questions WHERE type = "composite"');
  if (rows.length === 0) {
    console.log('No composite questions found');
    pool.end();
    return;
  }
  const q = rows[0];
  console.log('ID:', q.id);
  console.log('Type:', q.type);
  console.log('Content length:', q.content.length);
  console.log('Content preview:', q.content.substring(0, 100));
  console.log('Answers:', q.answers);
  try {
    const parsed = JSON.parse(q.answers);
    console.log('Parsed answers type:', Array.isArray(parsed) ? 'Array' : typeof parsed);
    console.log('Parsed answers length:', Array.isArray(parsed) ? parsed.length : 0);
    if (Array.isArray(parsed)) {
      console.log('\nSub-questions:');
      parsed.forEach((sq, i) => {
        console.log(`\n${i+1}. Type: ${sq.type}, Index: ${sq.index}, Score: ${sq.score}`);
        console.log('   Content:', sq.content.substring(0, 50));
        console.log('   Answers:', sq.answers);
        if (sq.options) console.log('   Options:', sq.options);
      });
    }
  } catch(e) {
    console.log('JSON parse error:', e.message);
  }
  pool.end();
})();
