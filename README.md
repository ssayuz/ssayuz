# ssayuz

🌐 **https://ssayuz.kro.kr** · 배포 방법은 [DEPLOY.md](DEPLOY.md)

> 짧게 말하고, 길게 이어지는 곳.

ssayuz는 **500자 글(Snippet)** 로 생각을 나누고 **답글**로 대화하는 텍스트 SNS예요. 사진 업로드 없이 글만 있어서 가볍고, 서버에는 DB 파일 하나만 있으면 돼요.

## 기능

**Snippet**
- 글 하나 최대 500자, 남은 글자 수 표시
- **Snippet 이어 쓰기**: 한 번에 최대 10개까지 이어서 올리기 (내 글에 내가 답글로 연결)
- 링크, `@멘션`, `#태그` 자동 연결
- **답글 허용 범위**: 누구나 / 내가 팔로우하는 사람만 / 언급한 사람만
- 좋아요 ♥, 답글 💬, **리포스트 🔁**, **인용**, 링크 공유
- 대화 보기: 위로는 원글들, 아래로는 답글들 (작성자의 이어 쓰기가 먼저)
- 답글이 달린 글을 지우면 "삭제한 Snippet" 자리만 남아 대화가 끊기지 않음

**피드**
- **추천**: 최근 2주 글을 좋아요·답글·리포스트와 최신순으로 점수 매김
- **팔로잉**: 내가 팔로우한 사람의 Snippet와 리포스트를 시간순으로
- 팔로우 추천 카드

**사람**
- 프로필: 이름, 소개, 링크, 팔로워/팔로잉, Snippet / 답글 / 리포스트 탭
- 프로필 사진 대신 이름 첫 글자 + 아이디마다 다른 색
- 검색: 사람, Snippet 내용, `#태그`

**활동 · 메시지 · 관리**
- 활동(알림): 좋아요, 답글, 리포스트, 인용, 팔로우, 멘션
- DM: 1:1 메시지, 자동 새로고침, 읽음 표시
- 관리자: Snippet 숨기기/복구, 계정 차단(사유)/해제, 관리 기록 (`/admin`)

**기타**
- 가입한 사람만 글쓰기 (보기는 누구나)
- G마켓 산스, 반응형 (모바일 하단 탭), 다크 모드 자동
- CSRF 보호, scrypt 비밀번호, CSP, HTML 이스케이프, 도배 방지

## 실행

Node.js **22.13 이상**이 필요해요 (내장 `node:sqlite` 사용).

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # 파일이 바뀌면 자동 재시작
```

데이터는 `data/ssayuz.db` 파일 하나에 저장돼요.

### 관리자 지정

```bash
npm run make-admin -- alice          # 이미 가입한 alice를 관리자로
ADMIN_USERNAMES=alice,bob npm start  # 이 아이디들은 시작할 때 / 가입할 때 관리자가 돼요
```

### 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `3000` | 서버 포트 |
| `DATA_DIR` | `./data` | DB 저장 위치 |
| `SITE_URL` | `https://ssayuz.kro.kr` | 서비스 주소 (링크 미리보기, 공유 링크) |
| `ADMIN_USERNAMES` | (없음) | 관리자로 지정할 아이디 (쉼표로 구분) |
| `TRUST_PROXY` | (없음) | 리버스 프록시 뒤라면 `1` |
| `COOKIE_SECURE` | (없음) | HTTPS로 서비스하면 `1` |
| `TZ` | `Asia/Seoul` | 시간대 |

## 주소

| 경로 | 화면 |
| --- | --- |
| `/`, `/?feed=following` | 홈 (추천 / 팔로잉) |
| `/compose`, `/compose?reply=번호`, `/compose?quote=번호` | 새 Snippet / 답글 / 인용 |
| `/@아이디/post/번호` | Snippet (대화) |
| `/@아이디`, `?tab=replies`, `?tab=reposts` | 프로필 |
| `/@아이디/followers`, `/@아이디/following` | 팔로워, 팔로잉 |
| `/search?q=` | 검색 |
| `/activity` | 활동 |
| `/dm`, `/dm/@아이디` | 메시지 |
| `/settings` | 프로필 편집 |
| `/admin` | 관리 (관리자만) |

## 구조

```
src/
  server.js               Express 앱
  db.js                   SQLite 스키마
  auth.js                 세션, 비밀번호, CSRF
  helpers.js              템플릿 헬퍼 (글 링크 처리, 아바타, 아이콘)
  notify.js               활동(알림)
  moderation.js           숨김 필터, 관리 기록
  routes/auth.js          가입 / 로그인
  routes/posts.js         피드, 글쓰기, Snippet, 좋아요, 리포스트, 검색
  routes/people.js        프로필, 팔로우, 프로필 편집
  routes/notifications.js 활동
  routes/dm.js            DM
  routes/admin.js         관리자
scripts/                  관리자 지정, 백업
views/                    EJS 템플릿
public/                   CSS, JS, 글꼴, 아이콘
```

글꼴 G마켓 산스는 ㈜지마켓이 무료로 배포하는 글꼴이에요.
