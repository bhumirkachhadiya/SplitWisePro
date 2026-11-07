const fs = require('fs');

function patch(file, reps) {
  let c = fs.readFileSync(file, 'utf8');
  for (const [a, b] of reps) {
    const n = c.split(a).length - 1;
    if (n === 0) { console.error('MISS in ' + file + ': ' + a.slice(0, 70)); process.exitCode = 1; continue; }
    c = c.split(a).join(b);
    console.log('OK(' + n + ') ' + file + ': ' + a.slice(0, 50).replace(/\n/g, '\\n'));
  }
  fs.writeFileSync(file, c);
}

patch('server.js', [
  ["SET password_hash = $1, plaintext_password = NULL, updated_at = NOW()", "SET password_hash = $1, updated_at = NOW()"],
  ["password_hash = $6, plaintext_password = NULL, updated_at = NOW()", "password_hash = $6, updated_at = NOW()"]
]);

patch('seed-db.js', [
  ["INSERT INTO users (id, name, email, password_hash, plaintext_password, avatar_initials, upi_id, phone) VALUES \n            (1, 'Alex Sharma', 'alex@splitease.io', $1, 'password123', 'AS', 'alex.sharma@okicici', '+91 98765 43210'),\n            (2, 'Rahul Sharma', 'rahul@example.com', $1, 'password123', 'RS', 'rahul.sharma@okaxis', '+91 98765 11111'),\n            (3, 'Priya Patel', 'priya@example.com', $1, 'password123', 'PP', 'priya.patel@icici', '+91 98765 22222'),\n            (4, 'Aman Verma', 'aman@example.com', $1, 'password123', 'AV', 'aman.verma@okhdfcbank', '+91 98765 33333'),\n            (5, 'Neha Reddy', 'neha@example.com', $1, 'password123', 'NR', 'neha.reddy@okaxis', '+91 98765 44444');",
   "INSERT INTO users (id, name, email, password_hash, avatar_initials, upi_id, phone) VALUES \n            (1, 'Alex Sharma', 'alex@splitease.io', $1, 'AS', 'alex.sharma@okicici', '+91 98765 43210'),\n            (2, 'Rahul Sharma', 'rahul@example.com', $1, 'RS', 'rahul.sharma@okaxis', '+91 98765 11111'),\n            (3, 'Priya Patel', 'priya@example.com', $1, 'PP', 'priya.patel@icici', '+91 98765 22222'),\n            (4, 'Aman Verma', 'aman@example.com', $1, 'AV', 'aman.verma@okhdfcbank', '+91 98765 33333'),\n            (5, 'Neha Reddy', 'neha@example.com', $1, 'NR', 'neha.reddy@okaxis', '+91 98765 44444');"]
]);

patch('setup-db.js', [
  ["                plaintext_password VARCHAR(255),\n", ""]
]);

patch('scripts/provision-master-admin.js', [
  [", password_hash = $${pIdx++}, plaintext_password = NULL", ", password_hash = $${pIdx++}"]
]);
