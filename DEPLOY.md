# ssayuz 배포하기 (ssayuz.kro.kr)

서버 한 대에 **Docker + Caddy**로 올리는 방법이에요. Caddy가 HTTPS 인증서(Let's Encrypt)를 자동으로 받아 주고, 3개월마다 알아서 갱신해요.

```
방문자 ──https──▶ Caddy (80/443, 인증서) ──▶ ssayuz 앱 (3000) ──▶ /data (DB + 사진)
```

## 0. 준비물

- **공인 IP가 있는 리눅스 서버** (Ubuntu 22.04/24.04 추천)
  - 예: Oracle Cloud 무료 서버, AWS Lightsail, Vultr, 집 PC(공유기 포트포워딩) 등
  - 사양은 1 vCPU / 1GB RAM이면 충분해요. 사진이 쌓이니 디스크는 넉넉할수록 좋아요.
- 서버에서 **80, 443 포트**가 열려 있어야 해요.
  - 클라우드라면 콘솔의 방화벽/보안 그룹에서 TCP 80, 443 (그리고 UDP 443) 허용
  - 서버 안에서 `ufw`를 쓰면: `sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp`

## 1. 도메인 연결 (내도메인.한국)

1. 내도메인.한국 → **도메인 관리** → `ssayuz.kro.kr` 수정
2. 맨 아래 **고급설정 (DNS)** 에서 **IP연결(A)** 체크
3. 앞 칸(`.ssayuz.kro.kr` 왼쪽)은 **비워 두고**, 오른쪽 칸에 **서버 공인 IPv4 주소** 입력 (예: `123.45.67.89`)
4. 보안코드 입력 → **수정하기**

> - **웹포워딩**, **단일페이지**는 체크하지 마세요. 켜면 IP연결과 충돌해요.
> - `www.ssayuz.kro.kr`도 쓰고 싶다면 IP연결(A)의 **[+]** 로 한 줄 더 만들고 앞 칸에 `www`, 같은 IP를 넣으세요. (아래 4번의 www 설정도 함께)
> - 반영까지 몇 분에서 길게는 몇 시간 걸릴 수 있어요. 확인: `nslookup ssayuz.kro.kr` 결과에 서버 IP가 나오면 OK.

## 2. 서버에 Docker 설치

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # 로그아웃 후 다시 로그인
```

## 3. ssayuz 받기 + 설정

```bash
git clone https://github.com/ssayuz/ssayuz.git
cd ssayuz
cp .env.example .env
nano .env        # ADMIN_USERNAMES=내아이디  (가입하면 관리자가 돼요)
```

> 저장소가 비공개라면 GitHub 토큰이나 SSH 키로 clone 하세요.

## 4. 실행

```bash
docker compose up -d --build
```

- 1~2분 뒤 **https://ssayuz.kro.kr** 접속 → 처음 실행이면 Caddy가 인증서를 받는 동안 몇 초 걸려요.
- `.env`의 `ADMIN_USERNAMES`에 넣은 아이디로 가입하면 관리자(🛡)가 돼요.
- 이미 가입한 사람을 관리자로: `docker compose exec app npm run make-admin -- 아이디`

**www도 쓸 때** `Caddyfile`을 이렇게 바꾸고 `docker compose restart caddy`:

```
{$DOMAIN} {
	encode zstd gzip
	reverse_proxy app:3000
}
www.{$DOMAIN} {
	redir https://{$DOMAIN}{uri} permanent
}
```

## 5. 자주 쓰는 명령

| 하고 싶은 것 | 명령 |
| --- | --- |
| 상태 보기 | `docker compose ps` |
| 로그 보기 | `docker compose logs -f app` (Caddy는 `caddy`) |
| 새 버전으로 업데이트 | `git pull && docker compose up -d --build` |
| 재시작 | `docker compose restart app` |
| 끄기 | `docker compose down` (데이터는 남아요) |
| 관리자 지정 | `docker compose exec app npm run make-admin -- 아이디` |

## 6. 백업

DB와 사진은 Docker 볼륨 `ssayuz_ssayuz_data`(컨테이너 안 `/data`)에 저장돼요.

```bash
# DB 스냅샷 (서비스 중에도 안전, 최근 14개 보관) → /data/backups/
docker compose exec app npm run backup

# DB + 사진 전체를 서버 폴더로 꺼내기
docker compose cp app:/data ./backup-$(date +%Y%m%d)
```

매일 새벽 4시에 자동 백업하려면 `crontab -e`에 추가:

```
0 4 * * * cd /home/ubuntu/ssayuz && docker compose exec -T app npm run backup >> backup.log 2>&1
```

> 서버가 통째로 날아가는 경우를 대비해, 꺼낸 백업은 가끔 내 PC나 다른 저장소로도 옮겨 두세요.

## 7. 문제 해결

- **https 접속이 안 돼요 / 인증서 오류**
  `docker compose logs caddy` 확인. 대부분 ① 도메인이 아직 서버 IP를 가리키지 않거나 ② 80/443 포트가 막혀 있는 경우예요. 고친 뒤 `docker compose restart caddy`.
- **손님 IP가 전부 `172.xx`로 보여요**
  Docker가 방문자 IP를 가리는 설정(userland-proxy)일 때 생겨요. `/etc/docker/daemon.json`에 `{"userland-proxy": false}`를 넣고 `sudo systemctl restart docker` 후 `docker compose up -d`.
- **집 PC에서 돌릴 때**
  공유기에서 80, 443 포트를 그 PC로 포트포워딩하고, 통신사 IP가 바뀌면 내도메인.한국의 IP연결도 다시 바꿔야 해요.

## Docker 없이 돌리기 (선택)

Node.js 22.13 이상을 설치한 뒤:

```bash
sudo useradd -r -m -d /opt/ssayuz ssayuz
sudo -u ssayuz git clone https://github.com/ssayuz/ssayuz.git /opt/ssayuz
cd /opt/ssayuz && sudo -u ssayuz npm ci --omit=dev
sudo -u ssayuz cp .env.example .env   # 값 수정
sudo cp deploy/ssayuz.service /etc/systemd/system/
sudo systemctl enable --now ssayuz
```

그리고 Caddy를 설치해 `/etc/caddy/Caddyfile`에 아래처럼 쓰면 HTTPS까지 끝나요.

```
ssayuz.kro.kr {
	encode zstd gzip
	reverse_proxy localhost:3000
}
```
