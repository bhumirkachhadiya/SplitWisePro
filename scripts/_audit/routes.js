const fs = require('fs');
const src = fs.readFileSync('server.js', 'utf8').split('\n');
const re = /app\.(get|post|put|patch|delete|use|all)\(\s*['"`]([^'"`]+)['"`]/g;
const routes = [];
src.forEach((line, i) => {
  let m;
  while ((m = re.exec(line))) routes.push({ method: m[1].toUpperCase(), path: m[2], line: i + 1 });
});
console.log('TOTAL ROUTES:', routes.length);
for (const r of routes) console.log(String(r.line).padStart(6), r.method.padEnd(7), r.path);
