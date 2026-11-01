const path = require('path');
const fs = require('fs');

if (!process.env.TZ) process.env.TZ = 'Asia/Seoul';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  // 실제 서비스 주소 (링크 미리보기, canonical 주소에 쓰임)
  SITE_URL: (process.env.SITE_URL || 'https://ssayuz.kro.kr').replace(/\/+$/, ''),
  DATA_DIR,
  UPLOAD_DIR,
  // HTTPS 뒤에서 돌릴 때 COOKIE_SECURE=1
  COOKIE_SECURE: process.env.COOKIE_SECURE === '1',
  // 리버스 프록시 뒤라면 TRUST_PROXY=1 (유동 IP 표시용)
  TRUST_PROXY: process.env.TRUST_PROXY,
  // 화력(🔥 - 🧊)이 이 값 이상이면 '불타는 글'
  HOT_THRESHOLD: Number(process.env.HOT_THRESHOLD) || 5,
  TALK_PAGE_SIZE: 25,
  FEED_PAGE_SIZE: 10,
  EXPLORE_PAGE_SIZE: 30,
  TOPICS: ['잡담', '정보', '질문', '짤'],
};
