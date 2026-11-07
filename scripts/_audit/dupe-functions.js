const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n');
const defs = new Map();
const add = (name, kind, index) => {
  if (!defs.has(name)) defs.set(name, []);
  defs.get(name).push({ kind, index });
};
let m;
const fn = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
while ((m = fn.exec(scripts))) add(m[1], 'function', m.index);
const wa = /window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g;
while ((m = wa.exec(scripts))) add(m[1], 'window-assignment', m.index);
const dups = [...defs.entries()].filter(([, v]) => v.length > 1);
console.log('duplicate callable definitions:', dups.length);
for (const [name, v] of dups) {
  const kinds = v.map(x => x.kind).join(', ');
  const lines = v.map(x => scripts.slice(0, x.index).split('\n').length).join(', ');
  console.log(`  ${name}: ${v.length} defs [${kinds}] (script lines ${lines})`);
}
