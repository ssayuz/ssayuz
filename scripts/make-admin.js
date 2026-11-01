// 사용법: npm run make-admin -- 아이디
const username = process.argv[2];
if (!username) {
  console.error('사용법: npm run make-admin -- <아이디>');
  process.exit(1);
}
const db = require('../src/db');
const r = db.prepare("UPDATE users SET role = 'admin' WHERE username = ?").run(username);
console.log(r.changes ? `@${username} 님을 관리자로 지정했어요.` : `@${username} 님을 찾을 수 없어요.`);
