const fs = require('fs');
const content = fs.readFileSync(__dirname + '/../index.html.backup', 'utf8');

const s1 = "} else if (viewName === 'friends') {\n                loadFriendsData();\n            }";
const s2 = 'updateUserProfileUI();\n            await refreshAllData();';
const s3 = 'populateDropdowns();\n            } catch(err) {';
const s4 = "currentUser = null;\n\n            // Immediately hide workspace";

console.log('s1 in backup:', content.includes(s1));
console.log('s2 in backup:', content.includes(s2));
console.log('s3 in backup:', content.includes(s3));
console.log('s4 in backup:', content.includes(s4));

process.exit(0);
