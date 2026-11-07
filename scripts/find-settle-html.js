const fs = require('fs');
const v1 = fs.readFileSync(__dirname + '/templates/views-part1.js', 'utf8');
const v2 = fs.readFileSync(__dirname + '/templates/views-part2.js', 'utf8');

const inV1 = v1.indexOf('id="view-settle"');
const inV2 = v2.indexOf('id="view-settle"');

console.log('In v1:', inV1, 'In v2:', inV2);

if (inV1 !== -1) {
    fs.writeFileSync(__dirname + '/view-settle-html.txt', v1.slice(inV1, inV1 + 3500), 'utf8');
} else if (inV2 !== -1) {
    fs.writeFileSync(__dirname + '/view-settle-html.txt', v2.slice(inV2, inV2 + 3500), 'utf8');
}
