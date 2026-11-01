const path = require('path');
const fs = require('fs');

if (!process.env.TZ) process.env.TZ = 'Asia/Seoul';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  DATA_DIR,
  UPLOAD_DIR,
  // HTTPS 뒤에서 돌릴 때 COOKIE_SECURE=1
  COOKIE_SECURE: process.env.COOKIE_SECURE === '1',
  // 리버스 프록시 뒤라면 TRUST_PROXY=1 (유동 IP 표시용)
  TRUST_PROXY: process.env.TRUST_PROXY,
  // 추천 수가 이 값 이상이면 개념글
  CONCEPT_THRESHOLD: Number(process.env.CONCEPT_THRESHOLD) || 5,
  GALLERY_PAGE_SIZE: 30,
  FEED_PAGE_SIZE: 10,
  EXPLORE_PAGE_SIZE: 30,
  HEADS: ['일반', '정보', '질문', '짤'],
};
