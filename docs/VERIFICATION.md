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
