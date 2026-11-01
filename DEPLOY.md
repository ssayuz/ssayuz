# ssayuz 올리기 — GitHub Pages + Supabase (무료, 카드 필요 없음)

```
방문자 ──▶ ssayuz.kro.kr (GitHub Pages: 화면)
               │
               └──▶ Supabase (가입·로그인, 글·좋아요·DM 저장, 보안 규칙)
```

전부 **휴대폰 브라우저로도** 할 수 있어요. 순서대로 따라 하세요.

---

## 1단계. Supabase 만들기 (DB + 로그인)

1. [supabase.com](https://supabase.com) → **Start your project** → **Continue with GitHub**
2. **New project**
   - Name: `ssayuz`
   - Database Password: 아무거나 길게 (어딘가 적어 두세요)
   - Region: **Northeast Asia (Seoul)**
   - **Create new project** → 1~2분 기다리기
3. 왼쪽 메뉴 **SQL Editor** → **New query**
   → 이 저장소의 [`supabase/schema.sql`](supabase/schema.sql) 내용을 **전부 복사해서 붙여넣기** → **Run**
   → 아래에 `Success. No rows returned` 가 나오면 성공
4. 왼쪽 메뉴 **Authentication** → **Sign In / Providers** (또는 Providers) → **Email**
   → **Confirm email** 을 **끄기(OFF)** → **Save**
   > ssayuz는 이메일 대신 **아이디 + 비밀번호**로 가입해요. 이걸 안 끄면 가입 후 로그인이 안 돼요.
5. 왼쪽 아래 ⚙️ **Project Settings** → **API** (또는 **Data API** / **API Keys**) 에서 두 값을 복사해 두세요
   - **Project URL** — `https://abcdefgh.supabase.co` 같은 주소
   - **anon / public** 키 — `eyJ...` 로 시작하는 긴 글자 (또는 `sb_publishable_...`)
   > ⚠️ **service_role / secret** 키는 절대 쓰지 마세요. 그건 비밀번호 같은 거예요.

## 2단계. 사이트에 Supabase 연결

1. GitHub에서 이 저장소의 [`docs/js/config.js`](docs/js/config.js) 파일 열기 → ✏️ (Edit)
2. 맨 위 두 줄을 1단계 5번에서 복사한 값으로 바꾸기

   ```js
   SUPABASE_URL: 'https://abcdefgh.supabase.co',
   SUPABASE_ANON_KEY: 'eyJhbGciOi....',
   ```
3. **Commit changes**

## 3단계. GitHub Pages 켜기

1. 저장소 **Settings** → 왼쪽 **Pages**
2. **Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: 코드가 있는 브랜치 (main에 합쳤다면 `main`) / 폴더: **`/docs`** → **Save**
3. 1~2분 뒤 **https://ssayuz.github.io/ssayuz/** 에 들어가 보세요. ssayuz가 보이면 성공!

## 4단계. ssayuz.kro.kr 연결

1. **내도메인.한국** → 도메인 관리 → `ssayuz.kro.kr` 수정 → **고급설정 (DNS)**
2. **IP연결(A)** 체크, 앞 칸은 **비워 두고** 오른쪽에 아래 주소를 넣기
   ( **[+]** 로 줄을 늘려 4개 모두 넣으면 가장 좋고, 1개만 넣어도 돼요)

   ```
   185.199.108.153
   185.199.109.153
   185.199.110.153
   185.199.111.153
   ```
3. 웹포워딩·단일페이지는 체크하지 말고 → 보안코드 → **수정하기**
4. GitHub 저장소 **Settings → Pages → Custom domain** 에 `ssayuz.kro.kr` 입력 → **Save**
   → 확인이 끝나면(몇 분~몇 시간) **Enforce HTTPS** 체크
5. **https://ssayuz.kro.kr** 접속! 🎉

## 5단계. 나를 관리자로

1. 사이트에서 내 아이디로 **가입**
2. Supabase **SQL Editor** 에서 아래를 실행 (`내아이디` 를 바꿔서)

   ```sql
   update public.profiles set role = 'admin' where username = '내아이디';
   ```
3. 사이트를 새로고침하면 위쪽에 🛡 (관리) 아이콘이 생겨요.

---

## 알아 두면 좋은 것

- **비밀번호 찾기는 없어요.** 이메일 없이 가입해서요. 관리자가 Supabase → Authentication → Users 에서 사용자를 지우고 다시 가입하게 할 수는 있어요.
- **무료 Supabase는 오래 아무도 안 쓰면 일시정지**될 수 있어요(보통 일주일). 그럴 땐 Supabase 대시보드에서 **Restore** 를 누르면 다시 켜져요.
- **보안은 DB가 지켜요.** 사이트 코드와 anon 키는 누구나 볼 수 있지만, `schema.sql` 의 규칙 때문에 남의 글 수정·남의 DM 읽기·관리자 기능 사용 같은 건 DB가 막아요.
- **백업:** Supabase → Database → Backups, 또는 Table Editor 에서 표마다 CSV로 내보내기.
- **DB 구조를 바꾼 새 버전이 나오면** `supabase/schema.sql` 을 SQL Editor 에서 다시 Run 하면 돼요. (여러 번 실행해도 안전하게 만들어져 있어요)

## 내 컴퓨터에서 테스트하기 (개발자용)

```bash
npx supabase start                     # Docker 필요. 로컬 DB + 로그인 서버
# supabase/schema.sql 을 로컬 DB에 실행 (Studio의 SQL Editor 또는 psql)
npx serve docs -l 8080                 # 또는 아무 정적 서버
# http://localhost:8080 → config.js 가 자동으로 로컬 Supabase에 연결
```
