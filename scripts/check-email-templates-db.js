const { pool } = require('../db');

async function main() {
  try {
    const res = await pool.query("SELECT id, template_type, subject, LENGTH(body_html) as html_len, LENGTH(body_text) as text_len FROM custom_email_templates");
    console.log("=== EMAIL TEMPLATES IN DB ===");
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
