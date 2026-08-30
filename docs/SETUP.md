# Kongjuworld v2.1 — 안전한 설치·배포 가이드

이 문서는 교육용 패키지를 **새 Supabase 프로젝트와 새 Vercel Preview**에 배포하는 절차입니다.

## 0. 적용 범위와 중단 조건

이 migration은 fresh project 기준으로 작성되었습니다. 다음 중 하나라도 해당하면 즉시 중단하세요.

- 기존 운영 앱이 사용하는 Supabase 프로젝트다.
- `public` schema에 사용자 테이블이나 함수·트리거가 있다.
- `auth.users`에 사용자가 있거나 Storage에 객체가 있다.
- Supabase migration history에 다른 앱의 migration이 있다.
- 백업과 rollback 없이 기존 도메인에 바로 배포하려 한다.

위 프로젝트를 재사용하려면 이 가이드가 아니라 기존 schema를 baseline으로 한 호환 migration과
데이터 이관 계획이 필요합니다. 제공된 SQL을 raw `psql` 또는 Dashboard SQL Editor에서 순서대로
실행하지 마세요. 파일별로 일부만 반영되면 migration history와 실제 schema가 달라질 수 있습니다.

## 1. 준비물

- Node.js 22와 Corepack으로 고정한 pnpm 10
- 공식 Supabase CLI, Docker 호환 런타임과 PostgreSQL `psql` client(로컬 DB·회귀 검사 시)
- 본인이 소유한 **새 Supabase 프로젝트**
- GitHub 저장소와 Vercel 프로젝트
- 비밀값을 저장할 비밀번호 관리자

CLI 명령은 설치한 버전의 도움말로 먼저 확인합니다.

```bash
supabase --version
supabase db push --help
supabase migration list --help
```

## 2. 환경변수와 비밀값

### 로컬

```bash
cp .env.example .env.local
```

`.env.local`은 로컬에서만 채웁니다. 실제 값이 든 `.env`, `.env.local`, DB URL 또는 owner 이메일
목록을 ZIP으로 만들거나 다른 사람에게 보내지 마세요. `vercel env pull`을 사용할 경우 대상 Vercel
프로젝트를 먼저 확인하고, 파일을 다시 공유하지 않습니다.

### 변수 표

| 변수 | 노출 | 필수 | 용도 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 브라우저 공개 | 예 | 새 Supabase Project URL, build 시 image host 등록 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 브라우저 공개 | 예 | publishable key 권장; 변수명은 코드 호환상 유지 |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 비밀 | 예 | secret key 권장; 초대 확인·Auth Admin·purge에 사용 |
| `NEXT_PUBLIC_SITE_URL` | 브라우저 공개 | 예 | Magic Link redirect 기준 HTTPS URL |
| `CRON_SECRET` | 서버 비밀 | Production | Vercel Cron Bearer 인증 |
| `SOFT_DELETE_RETENTION_DAYS` | 서버 설정 | 아니요 | 기본 30일 |
| `NEXT_PUBLIC_CANONICAL_HOST` | 브라우저 공개 | Production 권장 | 정식 host, scheme/path 제외 |
| `CANONICAL_REDIRECT_HOST` | 서버 설정 | 선택 | 정식 host로 보낼 대체 host |
| `TRAINING_PREVIEW_ENABLED` | 서버 설정 | 아니요 | 직원 연습용 `/training-preview`; 운영은 `false`/미설정 |
| `ENABLE_HSTS` | build 설정 | 선택 | 인증서 확인 뒤 Production에서만 `true` |

`NEXT_PUBLIC_` 변수는 브라우저 bundle에 포함됩니다. secret/service-role 값에는 절대로 이 접두사를
붙이지 마세요. Supabase의 새 `sb_publishable_...`/`sb_secret_...` 키를 우선 사용하고, 프로젝트에서
제공하지 않을 때만 legacy anon/service_role 키를 사용합니다.

## 3. 새 Supabase 프로젝트 구성

### 3-1. 프로젝트 생성과 사전 확인

1. Supabase Dashboard에서 이 앱 전용 새 프로젝트를 만듭니다. 사용자와 Storage 데이터가 없는지 확인합니다.
2. Project Settings에서 project ref를 확인합니다.
3. `supabase login`으로 본인 계정에 로그인합니다.
4. 잘못된 조직·프로젝트를 선택하지 않았는지 다시 확인합니다.

### 3-2. 로컬 migration 체인 검증

Docker를 사용할 수 있다면 원격에 적용하기 전에 로컬 DB에서 전체 체인을 재현합니다.

```bash
supabase start
supabase db reset
supabase migration list --local
```

`db reset`은 **로컬 Supabase만** 초기화합니다. `--linked`를 붙이면 원격을 지우는 파괴적 명령이므로
이 가이드에서는 사용하지 않습니다.

### 3-3. 원격 migration 적용

다음 스크립트는 DB URL이나 raw `psql`을 쓰지 않습니다. project ref 확인, remote history 표시,
`db push --dry-run`, project ref 재입력 후 `supabase db push` 순서로 실행합니다.

```bash
CONFIRM_FRESH_SUPABASE_PROJECT=YES_I_CREATED_A_NEW_PROJECT \
  ./scripts/apply-db.sh <project-ref>
```

적용 후 `supabase migration list`에서 아래 5개 local/remote migration이 모두 일치해야 합니다.

1. schema
2. RLS
3. private Storage buckets/policies
4. functions/triggers
5. Storage update/delete hardening

실패하면 raw SQL로 이어서 실행하거나 migration history를 임의 repair하지 마세요. 빈 교육용 프로젝트라면
새 프로젝트를 만들어 원인을 수정한 migration 체인을 처음부터 검증하는 편이 안전합니다.

### 3-4. hosted Auth/Data API 설정 별도 반영

`supabase db push`는 migration history와 SQL schema만 적용합니다. `supabase/config.toml`의 `[api]`,
`[auth]`, `[auth.email]` 값을 hosted 프로젝트에 자동 반영하지 않으며 `scripts/apply-db.sh`도 이를
변경하지 않습니다.

사용 중인 CLI가 지원하면 운영자가 linked project ref와 `supabase/config.toml` diff를 다시 검토하고,
migration 승인과 별도의 변경 승인을 받은 뒤 실행합니다.

```bash
supabase config push --help
# 대상 project ref와 config 변경 항목을 사람이 확인·승인한 뒤에만 실행
supabase config push
```

지원하지 않는 CLI이거나 자동 설정 변경을 허용하지 않는 조직은 Dashboard에서 직접 맞춥니다.

- [ ] Authentication → Sign In / Providers에서 **Allow new users to sign up** 비활성화
- [ ] Email signup도 비활성화되고 초대 로그인만 남았는지 확인
- [ ] Project Settings → Data API의 exposed schema가 `public` 하나로 제한됨
- [ ] `private`, `storage`, `auth` schema가 exposed schema 목록에 없음
- [ ] Extra search path가 `public`, `extensions`, Max rows가 1000인지 검토
- [ ] 설정 변경자·승인자·시간과 최종 Dashboard 화면을 secret 없이 기록

설정 push는 원격 Auth/Data API 동작을 바꿀 수 있습니다. 기존 운영 프로젝트에 실행하지 말고, migration이
성공했다는 이유로 hosted 설정까지 완료됐다고 표시하지 마세요.

### 3-5. family와 owner 1회 생성

`supabase/seed.example.sql`을 참고해 Supabase SQL Editor에서 family 1개와 owner 이메일 1개를
transaction으로 생성합니다. 실제 이메일을 채운 SQL 파일은 저장소나 ZIP에 남기지 않습니다.

owner는 `family_members.user_id = null`로 시작합니다. 첫 로그인 요청에서 서버가 초대 여부를 내부
확인하고 Auth 사용자를 생성하거나 재사용한 뒤 구성원 행을 연결합니다. 기존 Auth 사용자 등 예외 상황은
AAL2 완료 뒤 첫 데이터 요청의 `claim_membership()`이 제한적으로 보완합니다. 로그인 전에 다음을 확인하세요.

- family 1행 존재
- owner의 `invited_email`이 실제 로그인 이메일과 대소문자 무관하게 일치
- owner role이 `owner`
- 다른 구성원은 앱의 invite API로 추가하고 기본 role은 `member`

## 4. Supabase Auth 체크리스트

### 필수 앱 설정

- [ ] Authentication → URL Configuration의 Site URL을 프로덕션 HTTPS URL로 설정
- [ ] Redirect URLs에 `https://<domain>/auth/confirm` 추가
- [ ] 로컬 테스트 시 `http://localhost:3000/auth/confirm`만 별도로 추가
- [ ] Preview 로그인 시 해당 Preview URL을 명시적으로 추가; 불필요한 wildcard는 사용하지 않음
- [ ] Email Templates → Magic Link 링크를 아래 SSR callback 형식으로 설정

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">로그인</a>
```

- [ ] Authentication → Sign In / Providers에서 공개 가입 비활성화
- [ ] Authentication의 MFA 설정에서 TOTP factor 사용 가능 상태 확인
- [ ] OTP 만료시간과 Auth rate limit 검토
- [ ] 실제 운영은 custom SMTP와 발신 도메인 설정 검토

앱의 `/api/auth/login`은 초대 이메일만 service-role로 확인하고, 필요한 경우 Auth 사용자를 만든 뒤
`shouldCreateUser: false`로 Magic Link를 보냅니다. 공개 가입을 꺼도 초대 흐름은 유지됩니다. 이메일
열거를 막기 위해 초대 여부와 무관하게 같은 일반 성공 메시지를 반환하므로, 비초대 테스트는 응답
문구가 아니라 OTP 미발송과 서버 로그로 판정합니다.

### TOTP MFA와 AAL2 강제 흐름

- [ ] Supabase 조직/관리자 계정 MFA 활성화
- [ ] Vercel/GitHub 관리자 계정 MFA 활성화
- [ ] 첫 로그인과 재로그인에서 아래 앱 사용자 MFA 흐름을 각각 검증

1. 사용자가 `/login`에서 초대 이메일을 제출하고 Magic Link를 엽니다.
2. `/auth/confirm`이 OTP 또는 PKCE code를 교환해 AAL1 세션을 만든 뒤 `/auth/mfa`로 보냅니다.
3. 검증된 TOTP factor가 없으면 `/auth/mfa`가 factor를 enroll하고 QR/직접 입력 키를 표시합니다.
   인증 앱의 6자리 코드로 challenge/verify를 완료합니다.
4. 이미 검증된 factor가 있으면 같은 경로가 새 challenge를 만들고 6자리 코드를 검증합니다.
5. 성공하면 세션이 AAL2로 승격되고 `/`로 이동합니다.

middleware는 AAL1 세션에 `/auth/confirm`, `/auth/mfa`, `/api/auth/logout`만 허용합니다. 다른 화면은
`/auth/mfa`로 보내고 다른 API는 `mfa_required` 403을 반환합니다. DB에서도 migration 0002의
`private.has_aal2()`가 JWT의 `aal2`를 검사하며 모든 앱 table RLS 정책에 포함됩니다. migration 0003의
private Storage select 정책과 migration 0004의 membership claim/RPC도 AAL2를 요구합니다. 따라서 UI
redirect만 확인하지 말고 AAL1 세션으로 API, Data API, Storage를 직접 호출해 모두 차단되는지 시험합니다.

### TOTP 분실 복구

복구는 신원이 확인된 owner/admin만 수행합니다. 이메일이나 채팅 메시지만으로 factor를 해제하지 않습니다.

1. 별도 합의된 신원 확인 절차를 완료하고 요청자, 승인자, 사유와 시간을 기록합니다.
2. 승인된 owner/admin이 Supabase Dashboard의 해당 Auth 사용자에서 분실한 TOTP factor만 해제합니다.
3. 처리자와 처리 시간을 기록하고 사용자에게 기존 세션 종료 후 Magic Link로 다시 로그인하게 합니다.
4. 다음 `/auth/mfa` 화면에서 새 TOTP factor를 반드시 재등록·verify합니다.
5. AAL2 승격과 기존 factor 폐기를 확인하고 복구 티켓을 종료합니다.

Dashboard 접근권한을 여러 사람에게 공유하거나 service-role key로 임의 복구 스크립트를 만들지 마세요.
owner 본인이 유일한 관리자라면 잠금 전에 별도의 승인·복구 담당자를 지정합니다.

MFA 복구를 위해 Auth 사용자를 삭제하지 마세요. `family_members.user_id`는 연결 후 변경할 수 없는
append-only 값이고 `auth.users` FK는 `ON DELETE RESTRICT`이므로 연결된 사용자는 단순 삭제되지 않아야
합니다. 계정 영구 삭제가 별도로 필요하면 구성원/사진 귀속과 보존 의무, FK 동작, 감사 기록을 운영
담당자가 먼저 검증하고 승인된 전용 절차를 설계합니다. Dashboard에서 factor만 unenroll하는 복구와
Auth user 삭제를 같은 작업으로 취급하지 않습니다.

## 5. Database와 Storage 보안 체크리스트

- [ ] `families`, `family_members`, `photos`, `albums`, join table, comments/reactions 모두 RLS 활성
- [ ] 모든 authenticated table 정책이 `private.has_aal2()`를 조건으로 사용
- [ ] `anon` table 권한이 회수되었고 authenticated 정책이 family 경계를 검사
- [ ] `photos`, `thumbs` 버킷 모두 `public = false`
- [ ] authenticated select는 AAL2이며 현재 가족의 삭제·purge되지 않은 live DB row에 연결된 객체만 허용
- [ ] authenticated Storage INSERT 정책이 없고 업로드는 서버가 검증 후 발급한 signed upload token만 사용
- [ ] migration 0005 적용 후 authenticated update/delete Storage 정책도 없음
- [ ] 브라우저에 표시되는 URL이 `/storage/v1/object/sign/...` signed URL
- [ ] service-role/secret key가 Client Component, 브라우저 source map, 로그에 없음
- [ ] Supabase Security Advisor 경고 검토
- [ ] migration 적용 결과 `photos`는 50 MiB와 JPEG/PNG/WebP/GIF/AVIF, `thumbs`는 5 MiB와 WebP로 제한

private bucket은 public URL로 바꾸지 않습니다. private 파일 다운로드는 JWT가 적용되는 download 또는
만료시간이 있는 signed URL로만 수행합니다.

화면 표시용 read URL의 TTL은 1시간입니다. UI는 5분마다 상태를 확인해 마지막 성공 후 45분이 지나면
갱신하고, 실패하면 다음 5분 확인에서 재시도하며 탭 복귀 시에도 같은 조건으로 시도합니다. 비공개 URL이
Next.js image optimizer cache에 남지 않도록 모든 private media는 `unoptimized`로 렌더링합니다. 다운로드는
인증된 same-origin `/api/photos/:id/download`가 권한을 확인한 뒤 60초 download signed URL로 redirect합니다.
`photos`/`thumbs` bucket을 Public으로 바꾸거나 public URL을 저장하는 방식으로 우회하지 마세요.

## 6. Vercel 배포

### 6-1. Preview 먼저 배포

1. GitHub의 별도 review branch를 Vercel의 새 프로젝트로 Import합니다.
2. Framework Preset은 Next.js, package manager는 `pnpm`으로 확인합니다.
3. Settings → Environment Variables에서 값을 직접 등록합니다.
4. Preview를 먼저 배포하고 smoke test가 끝나기 전에는 프로덕션 도메인을 연결하지 않습니다.

Vercel 환경 범위 권장값:

| 변수 | Production | Preview | Development |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | prod project | 별도 staging 권장 | local/dev |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | prod publishable | staging publishable | local/dev |
| `SUPABASE_SERVICE_ROLE_KEY` | Sensitive | staging secret만 | 필요 시 local |
| `NEXT_PUBLIC_SITE_URL` | 정식 HTTPS URL | 고정 preview/staging URL | localhost |
| `CRON_SECRET` | Sensitive | 불필요 | 불필요 |
| `SOFT_DELETE_RETENTION_DAYS` | 정책값 | 테스트값 | 테스트값 |
| `TRAINING_PREVIEW_ENABLED` | `false`/미설정 | 직원 교육 때만 `true` | 필요할 때만 `true` |
| canonical/HSTS 변수 | Production만 | 비움 | 비움 |

Production과 Preview가 같은 Supabase 프로젝트를 사용하면 Preview 코드가 운영 데이터에 접근할 수 있습니다.
실데이터가 생기기 전부터 환경을 분리하는 것을 권장합니다.

`/training-preview`는 샘플 데이터로 디자인을 설명하는 직원 연습용 화면입니다. `demoMode`에서 실제
mutation을 수행하지 않는 read-only 동작을 확인하고, 교육 전용 Preview에서만
`TRAINING_PREVIEW_ENABLED=true`로 두세요. Production은 `false` 또는 미설정이어야 하며 해당 경로가
404인지 smoke test합니다. 값을 바꾼 뒤에는 재배포해야 합니다.

`NEXT_PUBLIC_SUPABASE_URL`은 `next.config.ts`가 image remote host를 만들 때 읽는 build-time 값입니다.
변경 후에는 반드시 재배포하세요.

### 6-2. Canonical host와 보안 헤더

`next.config.ts`는 모든 경로에 CSP, `nosniff`, frame 차단, `Referrer-Policy: no-referrer`,
Permissions Policy와 `X-Robots-Tag: noindex`를 적용합니다. 이 서비스는 private archive이므로 검색
인덱싱을 허용하지 않습니다.

대체 host를 정식 host로 보내려면 Production에만 설정합니다.

```dotenv
NEXT_PUBLIC_CANONICAL_HOST=www.example.com
CANONICAL_REDIRECT_HOST=example.com
```

Vercel Domains에서도 apex/www 중 하나를 정식 domain으로 선택하고 redirect 상태를 확인하세요.
두 환경변수는 scheme이나 path 없이 host만 받습니다. Preview에서는 비워야 Preview URL이 프로덕션으로
이동하지 않습니다.

HSTS는 DNS, TLS 인증서, 모든 subdomain의 HTTPS를 확인한 뒤 Production에 `ENABLE_HSTS=true`를 넣고
재배포합니다. 이 설정은 2년 `includeSubDomains` 정책이므로 잘못 활성화하면 HTTP subdomain 접근을
장기간 막을 수 있습니다. preload 제출은 별도 검토 없이는 하지 않습니다.

현재 CSP는 이식 디자인의 inline style과 Next.js hydration을 위해 `unsafe-inline`을 허용합니다.
nonce 기반 CSP를 구현하면 이 예외를 제거할 수 있습니다.

## 7. Vercel Cron

`vercel.json`은 매일 18:00 UTC(KST 다음 날 03:00)에 `/api/cron/purge`를 호출합니다.
Vercel Cron은 Production deployment에서만 실행됩니다.

- [ ] 비밀번호 관리자로 32바이트 이상의 `CRON_SECRET` 생성
- [ ] Vercel Production 환경에 Sensitive 값으로 직접 등록
- [ ] Preview/ZIP/Git에 secret을 복사하지 않음
- [ ] header 없이 `/api/cron/purge` 호출 시 401 확인
- [ ] 올바른 `Authorization: Bearer <CRON_SECRET>`에서만 성공 확인
- [ ] Vercel Runtime Logs에서 실행 결과와 오류 확인
- [ ] Hobby plan에서는 1일 1회보다 잦은 schedule을 사용하지 않음

purge는 soft-delete 보존기간이 지난 DB row와 `photos`/`thumbs` 객체를 물리 삭제합니다. 처음에는
테스트 데이터로 검증하고, 운영 데이터에는 백업·복구 정책을 먼저 정하세요.

## 8. 배포 전·후 검증

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm build
```

- [ ] 비로그인 `/` 접근 → `/login`
- [ ] 초대되지 않은 이메일 → 초대 이메일과 동일한 일반 성공 응답, OTP는 미발송(메일/로그로 확인)
- [ ] owner Magic Link → `/auth/confirm` 후 로그인
- [ ] 첫 로그인 → `/auth/mfa`에서 QR 등록과 6자리 verify 후 AAL2
- [ ] 로그아웃·재로그인 → 기존 TOTP factor challenge 후 AAL2
- [ ] AAL1 상태의 일반 화면 → `/auth/mfa`, 일반 API → `mfa_required` 403
- [ ] AAL1 상태의 Data API와 private Storage 직접 접근 → RLS 거부
- [ ] 사진 1장 업로드 → timeline 표시와 자동 연도 앨범 생성
- [ ] 동일 파일 재업로드 → duplicate 처리
- [ ] 즐겨찾기, manual 앨범, signed download 동작
- [ ] soft delete 후 즉시 목록에서 숨김
- [ ] `photos`/`thumbs`가 계속 Private
- [ ] 응답에 CSP, noindex, nosniff, frame/referrer/permissions 헤더 존재
- [ ] 대체 domain → canonical HTTPS redirect
- [ ] HSTS는 명시 승인 후에만 존재
- [ ] 운영 `/training-preview` 접근 → 404
- [ ] 직원 연습 환경에서만 `TRAINING_PREVIEW_ENABLED=true`와 샘플 화면 확인
- [ ] 직원 연습 화면의 모든 변경 동작이 read-only `demoMode`이며 실제 API/Storage를 쓰지 않음
- [ ] Vercel/Supabase 로그에 secret 또는 개인정보가 출력되지 않음

## 9. 장애와 rollback

- migration 실패: 추가 SQL을 실행하지 말고 `supabase migration list`와 오류를 보존해 인계
- Preview 실패: 프로덕션 domain을 연결하지 말고 마지막 정상 Preview/commit 유지
- Production 실패: 이전 Vercel deployment로 rollback하고 새 DB에 쓰기를 중단
- 데이터 손상: 임의 재실행 대신 백업 복원 절차 사용
- secret 노출: 해당 key/secret 즉시 rotate 후 Vercel에서 교체·재배포

공식 참고 문서:

- [Supabase local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
