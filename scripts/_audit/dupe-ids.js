const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const ids = {};
const re = /\bid=["']([^"']+)["']/g;
let m;
while ((m = re.exec(html))) {
  ids[m[1]] = (ids[m[1]] || 0) + 1;
}
const dupes = Object.entries(ids).filter(([, n]) => n > 1);
console.log('total ids:', Object.keys(ids).length);
console.log('duplicate ids:', dupes.length);
dupes.forEach(([id, n]) => console.log('  ' + id + ' x' + n));
