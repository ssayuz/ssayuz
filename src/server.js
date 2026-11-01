const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
require('./db');
const { loadSession, csrf } = require('./auth');
const helpers = require('./helpers');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.disable('x-powered-by');
if (config.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(config.TRUST_PROXY) ? Number(config.TRUST_PROXY) : config.TRUST_PROXY);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  });
  next();
});

app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.use('/uploads', express.static(config.UPLOAD_DIR, { maxAge: '7d', index: false }));

app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(cookieParser());
app.use(loadSession);
app.use((req, res, next) => {
  Object.assign(res.locals, helpers);
  res.locals.path = req.path;
  res.locals.title = null;
  next();
});
app.use(csrf);

app.use(require('./routes/auth'));
app.use('/talk', require('./routes/talk'));
app.use(require('./routes/stories'));
app.use(require('./routes/dm'));
app.use(require('./routes/notifications'));
app.use(require('./routes/admin'));
app.use(require('./routes/snap'));

app.use((req, res) => res.status(404).render('error', { title: '404', message: '여긴 아무것도 없어요.' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', { title: '오류', message: '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' });
});

// 24시간 지난 스토리 정리 (시작할 때 + 10분마다)
const { cleanupStories } = require('./routes/stories');
cleanupStories();
setInterval(cleanupStories, 10 * 60 * 1000).unref();

if (require.main === module) {
  app.listen(config.PORT, () => console.log(`ssayuz 실행 중: http://localhost:${config.PORT}`));
}

module.exports = app;
