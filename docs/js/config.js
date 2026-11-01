// ===================================================================
// ssayuz 설정 — Supabase 프로젝트를 만든 뒤 아래 두 값을 바꿔 주세요.
// Supabase 대시보드 → Project Settings → API (또는 Data API)
//   · Project URL         → SUPABASE_URL
//   · anon / public key   → SUPABASE_ANON_KEY  (공개해도 되는 키예요)
// ※ service_role / secret 키는 절대 여기에 넣지 마세요!
// ===================================================================
const PRODUCTION = {
  SUPABASE_URL: 'https://rmyazxlinbjlvjlorqnn.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_yCtR97chYL00K8fbHq_c_A_9CUm5oYh',
};

// 내 컴퓨터에서 테스트할 때 (supabase start 로 띄운 로컬 DB, 공개된 데모 키)
const LOCAL = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
};

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
export const { SUPABASE_URL, SUPABASE_ANON_KEY } = isLocal ? LOCAL : PRODUCTION;
export const CONFIGURED = !SUPABASE_URL.includes('YOUR-PROJECT');

// 아이디로 로그인하기 위해 내부적으로 쓰는 이메일 주소 (실제로 메일은 안 보내요)
export const EMAIL_DOMAIN = 'users.ssayuz.kro.kr';
