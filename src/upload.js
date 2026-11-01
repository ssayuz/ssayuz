const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { UPLOAD_DIR } = require('./config');

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + EXT[file.mimetype]),
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 10, fields: 20, fieldSize: 100 * 1024 },
  fileFilter: (req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(new Error('INVALID_TYPE'))),
});

// 파일 헤더(매직 바이트)로 실제 이미지인지 확인
function looksLikeImage(file) {
  const fd = fs.openSync(file.path, 'r');
  const b = Buffer.alloc(12);
  fs.readSync(fd, b, 0, 12, 0);
  fs.closeSync(fd);
  switch (path.extname(file.filename)) {
    case '.jpg': return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case '.png': return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case '.gif': return b.subarray(0, 4).toString('latin1') === 'GIF8';
    case '.webp': return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
    default: return false;
  }
}

function removeFiles(names) {
  for (const n of names || []) {
    if (typeof n !== 'string' || n.includes('/') || n.includes('\\')) continue;
    fs.unlink(path.join(UPLOAD_DIR, n), () => {});
  }
}

function fail(req, res, message) {
  removeFiles((req.files || []).map((f) => f.filename));
  res.status(400).render('error', { title: '업로드 실패', message });
}

// field 이름으로 최대 max 장 받기. 결과: req.uploaded = [파일명...]
function images(field, max) {
  const mw = upload.array(field, max);
  return (req, res, next) =>
    mw(req, res, (err) => {
      if (err) {
        const msg =
          err.message === 'INVALID_TYPE' ? 'JPG, PNG, GIF, WEBP 이미지만 올릴 수 있어요.'
          : err.code === 'LIMIT_FILE_SIZE' ? '이미지 한 장은 10MB 이하여야 해요.'
          : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `이미지는 최대 ${max}장까지 올릴 수 있어요.`
          : '업로드 중 문제가 생겼어요.';
        return fail(req, res, msg);
      }
      const files = req.files || [];
      if (!files.every(looksLikeImage)) return fail(req, res, '올바른 이미지 파일이 아니에요.');
      req.uploaded = files.map((f) => f.filename);
      req.body = req.body || {};
      next();
    });
}

module.exports = { images, removeFiles };
