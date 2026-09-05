# Kongjuworld v2.1 — 전달 전 검증 기록

검증일: 2026-08-30 UTC

이 문서는 전달 ZIP을 만들기 직전 수행한 검증과, 수령 후 반드시 이어서 확인할 항목을 구분해 기록합니다.

## 완료된 검사

| 항목 | 결과 |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | 통과, 선언된 pnpm 10.33.0 사용 |
| `pnpm audit --prod --audit-level=low` | 알려진 취약점 0건 |
| `pnpm lint` | 통과 |
| `pnpm typecheck` | 통과 |
| `pnpm test` | 5개 파일, 21개 테스트 통과 |
| `pnpm build` | Next.js 15.5.24 프로덕션 빌드 통과 |
| 교육 화면 실행 점검 | 활성화 시 HTTP 200, 비활성화 시 HTTP 404 |
| 보안 헤더 점검 | CSP, noindex, nosniff, DENY, no-referrer, Permissions Policy 확인 |
| 정적 파일 점검 | 교육용 샘플 이미지 HTTP 200 확인 |
| 비밀정보 검사 | 실제 `.env`, 키, 비밀번호, 프로젝트 ref, 사용자 이메일 없음 |
| 셸 스크립트 문법 | `scripts/apply-db.sh` 통과 |
| SQL·PL/pgSQL 정적 검토 | 5개 migration과 보안 회귀 SQL의 차단 이슈 없음 |

빌드와 실행 점검에는 실제 계정값이 아닌 테스트용 URL과 더미 키를 사용했습니다. 외부 Git 저장소,
Vercel 프로젝트, Supabase 프로젝트 또는 운영 도메인은 변경하지 않았습니다.

## 수령 후 필수 통합 검사

전달 환경에는 Docker, PostgreSQL, Supabase CLI가 없어 migration을 실제 DB에 실행하지 않았습니다.
수령자는 본인 장치의 로컬 Supabase에서 다음 검사를 완료해야 합니다.

```bash
supabase start
supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 \
  -f supabase/tests/security_regression.sql
```

이후에도 새로 만든 빈 Supabase 프로젝트에만 migration을 적용합니다. 기존 DB, Auth 사용자, Storage
객체 또는 migration history가 있으면 적용을 중단하고 별도 호환 migration을 설계해야 합니다.

실제 모바일 기기에서는 로그인, TOTP MFA, 사진 업로드, 다중 다운로드 허용, 화면 회전과 작은 화면
내비게이션을 Preview 환경에서 한 번 더 확인한 뒤 운영 전환 여부를 결정합니다.

## 원격 적용 기록 (2026-08-31 UTC)

「수령 후 필수 통합 검사」 중 원격 DB 적용분을 새로 만든 빈 Supabase 프로젝트에 수행했습니다.
적용 전 대상 프로젝트가 비어 있음을 확인했습니다: public 테이블 0개, migration history 0건,
Storage 버킷 0개. 기존 운영 DB에 적용한 것이 아닙니다.

| 항목 | 결과 |
| --- | --- |
| migration 5개 원격 적용 | 완료 |
| remote migration history | `20260830000001`~`20260830000005` 로 파일명과 일치 |
| `supabase/tests/security_regression.sql` | 원격 DB에서 22개 단언 전부 통과 |
| Storage 버킷 | `photos`, `thumbs` 생성, 둘 다 Private |
| Supabase security advisor | WARN 2건 — 설계상 의도된 항목 |
| owner 시드 | family 1건, owner 구성원 1건 생성 (`user_id`는 최초 로그인 시 연결) |

advisor 경고 2건은 `public.add_photos_to_album`과 `public.claim_membership`이 `authenticated`에게
EXECUTE 되어 있다는 내용입니다. 두 함수 모두 본문에서 AAL2와 활성 멤버십을 직접 검사하므로
의도된 설계입니다.

migration은 Supabase CLI가 아닌 관리 API로 적용했습니다. 이 경로는 버전을 적용 시각으로 기록하므로,
이후 `supabase db push`가 5개를 미적용으로 오인하지 않도록 history의 version을 파일명 접두사와
일치하도록 정정했습니다.

## 배포 전환 시 남은 항목

다음 항목은 migration으로 반영되지 않으므로 콘솔에서 직접 설정하고 확인해야 합니다.

- hosted Auth 설정: 공개 가입 차단, TOTP MFA 활성화, Magic Link redirect URL 등록
- Vercel 환경변수 등록 — `NEXT_PUBLIC_*` 값은 빌드 시점에 번들에 포함되므로, 등록 전에 만들어진
  배포는 값을 나중에 추가해도 재배포 전까지 반영되지 않습니다
- 운영 도메인 연결과 DNS 레코드 등록
- `CRON_SECRET`은 Production 환경에만 등록
- 첫 로그인 TOTP 등록, 다음 로그인 challenge, AAL1 차단 확인

## Vercel 프로젝트 연결 기록 (2026-09-05 UTC)

HANDOVER 단계 F에 따라 이 저장소 전용 Vercel 프로젝트를 만들고 GitHub에 연결했습니다.
값 자체는 기록하지 않고 "어디에 어떤 이름을 어느 scope로 넣었는지"만 남깁니다.

| 항목 | 값 |
| --- | --- |
| Vercel 팀 | `HPeng` (slug `hp-eng`, Hobby) |
| Vercel 프로젝트 | `kongjuworld` |
| Git 연결 | `c003-del/kongju`, Production Branch `main` |
| Supabase 프로젝트 | ref `sddkavaejlificbjmmql`, 리전 `ap-northeast-2` |

Production scope에 등록 완료한 변수 이름:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`(Sensitive), `CRON_SECRET`(Sensitive),
`SOFT_DELETE_RETENTION_DAYS`, `TRAINING_PREVIEW_ENABLED`, `ENABLE_HSTS`.

아직 등록하지 않은 변수와 그 조건:

- `NEXT_PUBLIC_SITE_URL` — 첫 배포 URL이 확정된 뒤 등록하고 재배포합니다.
- `NEXT_PUBLIC_CANONICAL_HOST`, `CANONICAL_REDIRECT_HOST` — 운영 도메인 연결 후.
- `ENABLE_HSTS=true` 전환 — TLS와 모든 서브도메인 확인 후 (단계 G).

Hobby 플랜의 cron은 1일 1회로 제한되므로 `vercel.json`의 `0 18 * * *` 스케줄은 그대로
유효합니다. 다만 Hobby에서는 실행 시각이 정확히 보장되지 않습니다.

수령 소스 기준 로컬 검증은 `pnpm install --frozen-lockfile`, `pnpm typecheck`,
`pnpm build` 모두 통과했습니다(단계 A).
