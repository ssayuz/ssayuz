const path = require('path');
const fs = require('fs');

if (!process.env.TZ) process.env.TZ = 'Asia/Seoul';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  // 실제 서비스 주소 (링크 미리보기, canonical 주소에 쓰임)
  SITE_URL: (process.env.SITE_URL || 'https://ssayuz.kro.kr').replace(/\/+$/, ''),
  DATA_DIR,
  // HTTPS 뒤에서 돌릴 때 COOKIE_SECURE=1
  COOKIE_SECURE: process.env.COOKIE_SECURE === '1',
  // 리버스 프록시 뒤라면 TRUST_PROXY=1
  TRUST_PROXY: process.env.TRUST_PROXY,
  POST_MAX: 500, // 글 한 개 최대 글자 수
  THREAD_MAX_PARTS: 10, // 한 번에 이어 쓸 수 있는 글 수
  FEED_PAGE_SIZE: 20,
};
