// DB 백업: DATA_DIR/backups/ssayuz-YYYYMMDD-HHMMSS.db 로 안전하게 복사 (서비스 중에도 가능)
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../src/config');
const db = require('../src/db');

const dir = path.join(DATA_DIR, 'backups');
fs.mkdirSync(dir, { recursive: true });
const d = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const name = `ssayuz-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.db`;
const out = path.join(dir, name);
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
console.log('백업 완료:', out);

// 최근 14개만 남기기
const files = fs.readdirSync(dir).filter((f) => /^ssayuz-\d{8}-\d{6}\.db$/.test(f)).sort();
for (const f of files.slice(0, -14)) fs.unlinkSync(path.join(dir, f));
