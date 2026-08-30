# Kongjuworld v2.1 — 교육용 인수인계서

이 문서는 소스 수령자가 본인 소유의 **새 Supabase 프로젝트와 새 Vercel 프로젝트**에 Preview를
만들고, 검증 후 운영 여부를 판단하기 위한 체크리스트입니다. 실제 계정이나 secret을 대신 받아
보관하는 절차가 아닙니다.

## 1. 전달물과 경계

### 전달하는 것

- Next.js/TypeScript source와 pnpm lockfile
- Supabase migration 5개, seed 예시와 CLI 적용 도우미
- `.env.example`의 공개 가능한 변수 이름
- Vercel Cron과 보안 header/canonical 설정
- 설치·검증 절차

### 전달하지 않는 것

- `.env`, `.env.local`, 실제 API key/secret, DB URL·비밀번호
- owner·가족 이메일 목록
- Supabase access token, Vercel token, GitHub token
- 운영 DB dump나 Storage 원본

> 실제 값을 넣은 `.env` ZIP을 요청하거나 전달하지 마세요. 수령자가 Supabase/Vercel Dashboard에
> 직접 입력하고, 필요한 로컬 값은 본인 장치의 `.env.local`에만 둡니다.

## 2. 이 패키지의 전제

| 항목 | 전제 |
| --- | --- |
| Supabase | 이 앱 전용으로 새로 만든 빈 프로젝트 |
| Database | migration 5개를 CLI history로 순서대로 적용 |
| Hosted config | `db push`와 별도; 승인된 `config push` 또는 Dashboard 수동 검증 |
| Auth | 초대 이메일 + Magic Link, 공개 가입 차단 |
| App-user MFA | `/auth/mfa` TOTP 등록/challenge와 middleware·RLS AAL2 강제 |
| Storage | private bucket, AAL2 live-row read와 server-issued signed upload |
| Vercel | 새 Preview에서 먼저 검증, secret은 Dashboard에 직접 등록 |
| Cron | Production에서 매일 18:00 UTC, `CRON_SECRET` 필수 |
| Training preview | 샘플 데이터 read-only `demoMode`; 직원 교육에서만 활성화, 운영은 404 |
| Search | private archive이므로 `X-Robots-Tag: noindex` 고정 |

기존 운영 Supabase/Vercel 앱에 덮어쓰는 upgrade package가 아닙니다. 기존 DB 재사용 요청이 나오면
작업을 멈추고 schema diff, 데이터 이관, trigger·migration history 충돌, backup/rollback을 별도 설계하세요.

## 3. 교육 진행 순서

### 단계 A — source 무결성

- [ ] ZIP을 새 디렉터리에 풀고 `node_modules`, `.next`, `.env*` 실제값이 포함되지 않았는지 확인
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build` 통과
- [ ] Git 저장소를 만들 경우 첫 commit 전에 `git status --ignored`로 secret 제외 확인

### 단계 B — fresh Supabase 확인

- [ ] 수령자 본인 조직에 새 프로젝트 생성
- [ ] public 사용자 table 없음
- [ ] auth.users 0명
- [ ] Storage object 0개
- [ ] 다른 앱의 migration history 없음
- [ ] Supabase 관리자 계정 MFA 활성화

하나라도 다르면 `scripts/apply-db.sh`를 실행하지 않습니다.

### 단계 C — migration

```bash
supabase login

# 권장: 로컬 전체 체인 검증
supabase start
supabase db reset

# 새 원격 프로젝트에만 적용
CONFIRM_FRESH_SUPABASE_PROJECT=YES_I_CREATED_A_NEW_PROJECT \
  ./scripts/apply-db.sh <project-ref>
```

- [ ] dry-run에서 5개 migration만 확인
- [ ] project ref를 사람이 다시 입력한 뒤 적용
- [ ] 적용 후 local/remote history 일치
- [ ] Security Advisor 검토
- [ ] `db push`가 hosted `config.toml`을 적용하지 않는다는 사실 확인
- [ ] 별도 승인된 `supabase config push` 또는 Dashboard 수동 설정 완료
- [ ] Data API exposed schema는 `public`만, Auth 공개 signup은 off

실패 시 raw `psql`, SQL Editor 연속 실행, history repair로 즉석 복구하지 않습니다. 로그와
`supabase migration list`를 보존하고 원인을 먼저 수정합니다.

### 단계 D — owner와 Auth

- [ ] `supabase/seed.example.sql`을 참고해 family 1개와 owner 초대 이메일 1개 생성
- [ ] 실제 이메일을 넣은 SQL을 source/ZIP에서 제거
- [ ] Site URL과 `/auth/confirm` Redirect URL 설정
- [ ] Magic Link template을 token-hash callback 형식으로 변경
- [ ] 공개 가입 비활성화
- [ ] 초대/미초대 이메일 모두 동일한 일반 성공 응답이며 미초대에는 메일이 발송되지 않음
- [ ] OTP expiry/rate limit 및 custom SMTP 검토
- [ ] Supabase Auth에서 TOTP factor 사용 가능 상태 확인
- [ ] 첫 Magic Link → `/auth/mfa`에서 QR enroll/challenge/verify → AAL2 확인
- [ ] 다음 Magic Link → 기존 factor challenge/verify → AAL2 확인
- [ ] AAL1은 MFA/로그아웃 경로 외 화면·API에서 차단됨
- [ ] AAL1의 직접 Data API/Storage 접근도 `private.has_aal2()` RLS로 차단됨
- [ ] 분실 복구의 신원 확인자, 승인자와 처리 로그 보관 위치 지정

MFA 회귀 테스트가 실패하면 여기서 **출시 중단**입니다. `/auth/confirm`은 AAL1 세션을 `/auth/mfa`로
보내고, middleware는 AAL1의 일반 UI를 해당 경로로 redirect하며 일반 API는 `mfa_required` 403으로
차단해야 합니다. DB table 정책, private Storage 정책과 membership claim/RPC도 JWT `aal2`를 요구합니다.

TOTP 분실 시에는 신원이 확인된 owner/admin만 Supabase Dashboard에서 해당 사용자의 분실 factor를
해제하고, 다음 Magic Link 로그인에서 `/auth/mfa` 재등록을 완료하게 합니다. 요청·승인·처리자·시간을
기록하며 이메일/채팅만으로 해제하지 않습니다. owner가 유일한 관리자라면 별도 복구 담당자를 먼저
지정합니다.

factor 복구를 Auth user 삭제로 대신하지 않습니다. `family_members.user_id`는 append-only이고
`auth.users` FK가 `ON DELETE RESTRICT`이므로, 계정 영구 삭제 전에는 귀속 데이터·보존 의무·FK 동작을
별도 운영 절차로 검증하고 승인 기록을 남깁니다.

### 단계 E — Storage

- [ ] `photos`, `thumbs` 모두 Private
- [ ] AAL2이며 현재 가족의 live DB row에 연결된 객체만 select되는지 확인
- [ ] authenticated INSERT 정책 없이 server-issued signed upload token만 사용하는지 확인
- [ ] 화면 read URL TTL 1시간, 5분 check·45분 guard·실패 재시도·탭 복귀 refresh 확인
- [ ] same-origin 다운로드 endpoint가 권한 확인 후 60초 download signed URL로 redirect
- [ ] authenticated 사용자의 object update/delete 정책이 없음
- [ ] `photos` 50 MiB·JPEG/PNG/WebP/GIF/AVIF, `thumbs` 5 MiB·WebP 제한 확인
- [ ] service-role/secret key가 브라우저에 노출되지 않음

### 단계 F — Vercel Preview

- [ ] GitHub review branch를 **새 Vercel 프로젝트**로 Import
- [ ] `.env.example`의 값을 Settings → Environment Variables에 직접 입력
- [ ] `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`은 Sensitive로 저장
- [ ] Production/Preview가 실데이터 Supabase를 공유하지 않도록 결정
- [ ] Preview에는 canonical/HSTS 변수 미설정
- [ ] 직원 연습용 Preview에서만 `TRAINING_PREVIEW_ENABLED=true`
- [ ] 연습 화면이 read-only `demoMode`이고 실제 API/Storage mutation을 수행하지 않음
- [ ] Preview build 및 smoke test 통과

Preview URL로 Magic Link를 시험하려면 그 URL을 Supabase Redirect URLs에 명시적으로 추가합니다.
검증 전에 production domain을 붙이지 않습니다.

### 단계 G — Production 승인

- [ ] 기능 smoke test 전부 통과
- [ ] CSP/noindex/security header 확인
- [ ] apex/www canonical redirect 확인
- [ ] TLS와 모든 subdomain 확인 후에만 `ENABLE_HSTS=true`
- [ ] Production에서 `TRAINING_PREVIEW_ENABLED`가 `false`/미설정이고 `/training-preview`가 404
- [ ] Production `CRON_SECRET`과 daily cron 확인
- [ ] backup, retention, rollback 책임자 지정
- [ ] 기존 서비스가 있다면 마지막 정상 deployment와 DB를 그대로 보존

## 4. Vercel 환경변수 인계표

값 자체가 아니라 “누가, 어디에, 어느 scope로 넣었는지”만 기록합니다.

| 변수 | 권장 scope | 값 기록 금지 | 확인자 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 환경별 | URL은 Dashboard에서 확인 |  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 환경별 | publishable key 원문 금지 |  |
| `SUPABASE_SERVICE_ROLE_KEY` | 환경별 Sensitive | secret 원문 금지 |  |
| `NEXT_PUBLIC_SITE_URL` | 환경별 | 최종 URL만 별도 문서화 가능 |  |
| `CRON_SECRET` | Production Sensitive | 원문 금지 |  |
| `SOFT_DELETE_RETENTION_DAYS` | 환경별 | 정책값만 기록 |  |
| `TRAINING_PREVIEW_ENABLED` | 교육용 Preview만 `true` | 운영은 `false`/미설정 |  |
| canonical host 변수 | Production | host만 기록 |  |
| `ENABLE_HSTS` | Production | 승인 뒤 `true` |  |

환경변수를 추가·교체하면 이전 deployment가 아니라 새 deployment에서 값을 확인합니다.
`NEXT_PUBLIC_*`, canonical, HSTS와 image host는 build 결과에 영향을 주므로 반드시 재배포합니다.

## 5. 인수 테스트

| 영역 | 합격 조건 |
| --- | --- |
| Auth | 비인증 redirect, 비초대 일반 응답·OTP 미발송, Magic Link와 TOTP AAL2 성공 |
| MFA defense | AAL1의 일반 UI/API/Data API/Storage 차단, 첫 등록·재로그인 challenge·복구 절차 |
| Authorization | 다른 family row/object 접근 차단 |
| Upload | 사진/썸네일 private upload, SHA-256 duplicate skip |
| Browse | timeline, year/album/person/tag/favorite filter |
| Delete | soft delete 후 숨김, 보존기간 전 object 유지 |
| Cron | no secret=401, Production scheduler 호출과 purge log 확인 |
| Headers | CSP, noindex, nosniff, DENY, no-referrer, Permissions Policy |
| Domain | 대체 host가 canonical HTTPS로 영구 redirect |
| Training | 샘플 화면은 read-only `demoMode`, 직원 연습 환경에서만 노출, Production은 404 |
| Secrets | Git/ZIP/client/log에 secret 없음 |

## 6. 운영 제한과 의사결정 기록

출시 승인 문서에 다음 결정을 남깁니다.

- TOTP 분실 시 신원 확인자·승인자·Dashboard 처리자와 감사 로그 보관기간
- 사진 최대 크기·허용 MIME과 총 저장용량
- soft-delete 보존기간과 오프사이트 backup
- Preview/Production Supabase 분리 여부
- custom SMTP, 이메일 전달 실패 대응
- owner 부재 시 두 번째 관리자/복구 담당자
- CSP의 `unsafe-inline`을 nonce 방식으로 개선할 일정

## 7. 장애 인계

### Migration 실패

1. 더 이상 SQL을 실행하지 않습니다.
2. project ref, CLI version, 실패 migration과 `migration list`를 기록합니다.
3. 빈 교육 프로젝트면 수정 후 새 프로젝트에서 재현합니다.
4. 운영 데이터가 있었다면 복구 담당자가 backup 기준으로 판단합니다.

### 배포 실패

1. 도메인을 새 deployment로 전환하지 않습니다.
2. Preview build/runtime log를 확인합니다.
3. 환경변수 이름과 scope만 확인하고 값은 티켓·채팅에 붙이지 않습니다.

### Secret 노출

1. 노출된 Supabase key/`CRON_SECRET`을 즉시 rotate합니다.
2. Vercel 환경변수를 교체하고 재배포합니다.
3. Git history, build log와 배포 산출물의 잔존 여부를 확인합니다.

## 8. 다음 담당자에게 전달할 짧은 지시문

```text
이 저장소는 fresh Supabase project 전용 교육 패키지다.
docs/SETUP.md 순서대로 별도 Preview를 만들고, 기존 운영 DB에는 어떤 migration도 실행하지 마라.
실제 secret/.env/이메일을 받거나 ZIP·Git에 저장하지 말고 Vercel/Supabase Dashboard에 직접 입력하라.
scripts/apply-db.sh의 fresh-project 확인, dry-run, project-ref 재확인을 건너뛰지 마라.
첫 등록과 재로그인 challenge를 확인하고 AAL1의 UI/API/Data API/Storage 차단이 실패하면 출시하지 마라.
TOTP factor는 신원 확인·승인·처리 로그 없이 이메일이나 채팅 요청만으로 해제하지 마라.
private Storage/RLS/Cron/security header/canonical/noindex와 rollback 체크리스트를 모두 증빙하라.
```

세부 명령과 공식 문서 링크는 [SETUP.md](SETUP.md)를 기준으로 합니다.
