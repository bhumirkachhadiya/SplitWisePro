const fs = require('fs');
const h = fs.readFileSync('index.html', 'utf8');
for (const id of ['tabContentOwe', 'tabContentOwed', 'settlePeerCardsContainer', 'settleOwedCardsContainer']) {
  const re = new RegExp('id="' + id + '"', 'g');
  console.log(id, (h.match(re) || []).length);
}
