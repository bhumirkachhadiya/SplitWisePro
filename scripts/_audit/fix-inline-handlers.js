const fs = require('fs');
let c = fs.readFileSync('index.html', 'utf8');
const reps = [
  [`onclick="handleRemoveFriend(\${f.id}, '\${f.name.replace(/'/g, "\\\\'")}')"`,
   `onclick="handleRemoveFriend(\${f.id}, \${jsAttr(f.name)})"`],
  [`onclick="openSettleForPeer(\${peer.user_id}, '\${peer.name}', \${peer.amount}, '\${peer.upi_id || ''}', '\${peer.avatar_initials || 'U'}')"`,
   `onclick="openSettleForPeer(\${peer.user_id}, \${jsAttr(peer.name)}, \${peer.amount}, \${jsAttr(peer.upi_id || '')}, \${jsAttr(peer.avatar_initials || 'U')})"`],
  [`onclick="copyReminderText('\${peer.name}', \${peer.amount})"`,
   `onclick="copyReminderText(\${jsAttr(peer.name)}, \${peer.amount})"`],
  [`onclick="sendPeerEmailReminder(\${peer.user_id}, '\${peer.name}', \${peer.amount})"`,
   `onclick="sendPeerEmailReminder(\${peer.user_id}, \${jsAttr(peer.name)}, \${peer.amount})"`],
  [`onclick="openSettleForPeer(\${p.id}, '\${p.name}', \${amt}, '\${p.upi_id || ''}', '\${p.avatar_initials || 'U'}')"`,
   `onclick="openSettleForPeer(\${p.id}, \${jsAttr(p.name)}, \${amt}, \${jsAttr(p.upi_id || '')}, \${jsAttr(p.avatar_initials || 'U')})"`]
];
for (const [a, b] of reps) {
  const n = c.split(a).length - 1;
  if (n === 0) { console.error('MISS: ' + a.slice(0, 80)); process.exitCode = 1; continue; }
  c = c.split(a).join(b);
  console.log('OK(' + n + ')');
}
fs.writeFileSync('index.html', c);
console.log('done');
