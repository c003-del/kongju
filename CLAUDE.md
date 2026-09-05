# Kongjuworld — 배포 지침

비공개 가족 사진 보관소. Next.js 15 App Router + Supabase(Postgres/Auth/Storage) + Vercel.
이 파일은 배포와 운영 규칙만 다룬다. 설치 절차는 [docs/SETUP.md](docs/SETUP.md),
인수인계 체크리스트는 [docs/HANDOVER.md](docs/HANDOVER.md), 배포 이력은
[docs/VERIFICATION.md](docs/VERIFICATION.md)에 있다.

## 배포 구조

| 대상 | 경로 | 트리거 |
| --- | --- | --- |
| 앱 | Vercel 프로젝트 `kongju` (팀 `hp-eng`) | `main` 머지 → Git 연동이 Production 배포. PR → Preview |
| DB | Supabase `krddetoqnsdlznzhdvre` (`ap-southeast-2`) | `main` 머지 → `.github/workflows/deploy-supabase.yml` |

둘 다 **개인 토큰에 의존하지 않는다.** Vercel은 GitHub App webhook, Supabase는 저장소
secret(`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`)과 변수/secret
`SUPABASE_PROJECT_REF`를 쓴다. 셋 중 하나라도 없으면 워크플로는 아무것도 적용하지
않고 무엇이 비었는지만 알림에 남기고 끝난다.

배포하려고 로컬에서 `vercel deploy`나 `supabase db push`를 직접 실행하지 않는다.
머지가 유일한 배포 경로다.

## 절대 하지 않는 것

- 실제 키·비밀번호·DB URL·이메일을 저장소, 커밋 메시지, PR 본문, 로그, 문서에 넣기.
  `.env.example`에는 **이름만** 둔다. 값은 Vercel/Supabase 콘솔에만 입력한다.
- **이미 적용된 migration 파일 수정·삭제·이름변경.** `supabase db push`가 조용히
  건너뛰어 로컬과 원격 history가 어긋난다. 변경이 필요하면 새 migration을 추가한다.
- 원격 프로젝트에 `supabase db reset`, raw `psql`, SQL Editor 직접 실행으로 스키마 고치기.
- `scripts/guard-migrations.sh` 우회하거나 게이트를 느슨하게 고치기.
- Supabase 공개 가입 활성화. `photos`/`thumbs` 버킷을 Public으로 전환.
- 운영에서 `TRAINING_PREVIEW_ENABLED=true`. TLS·서브도메인 확인 전에 `ENABLE_HSTS=true`.
- AAL2/RLS 검사를 우회하는 코드 추가. 테스트를 skip·비활성화해서 CI 통과시키기.

## Migration 작성 절차

1. `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql` 로 **새 파일만** 추가한다.
   기존 5개(`20260830000001`~`20260830000005`)는 원격에 적용 완료 상태다.
2. 게이트를 로컬에서 먼저 돌린다.

   ```bash
   ./scripts/guard-migrations.sh origin/main HEAD
   ```

3. 가능하면 로컬 Supabase에서 전체 체인과 보안 회귀를 재현한다.

   ```bash
   supabase start && supabase db reset
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     -v ON_ERROR_STOP=1 -f supabase/tests/security_regression.sql
   ```

4. PR을 열고 사람이 읽은 뒤 머지한다. 머지 시 워크플로가 새 파일만 적용한다.

### 게이트가 막는 것

`supabase db push`는 DB를 reset하지 않고 이미 적용된 migration을 다시 실행하지도
않는다. 그래서 자동 적용의 데이터 손실 경로는 "파괴적 SQL이 든 새 migration이
머지되는 것" 하나뿐이고, 게이트가 그걸 막는다.

| 상황 | 결과 |
| --- | --- |
| 새 migration의 `drop table/schema/column`, `truncate`, `delete from` | 실패, 아무것도 적용 안 됨 |
| 이미 적용된 migration 파일 수정·삭제·이름변경 | 실패 |
| `create function` 본문 안의 `delete from` | 통과 (적용 시점에 실행되지 않음) |
| `do $$ … $$;` 블록 안의 파괴적 SQL | 차단 (즉시 실행되므로) |
| `drop policy` / `drop trigger` / `drop function` | 통과 (데이터 손실 아님) |

**`main` 머지만으로는 파괴적 migration이 적용되지 않는다.** 정말 필요하면 백업을
확인한 뒤 Actions → "Deploy Supabase migrations"를 수동 실행하고, `project_ref`를
사람이 직접 입력하며 `allow_destructive`를 켠다. 이 판단은 사람이 한다 — 에이전트가
스스로 `allow_destructive`를 켜지 않는다.

## 머지 전 로컬 검증

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

CI(`.github/workflows/ci.yml`)가 여기에 `pnpm audit:prod`를 더해 같은 것을 돌린다.
빌드는 환경변수 없이도 통과해야 한다 — 미확정 슬롯은 런타임에만 필요하다.

## 환경변수

이름과 scope만 여기 적는다. 값은 Vercel 콘솔에 직접 넣는다.

| 변수 | scope |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Production |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production (publishable key) |
| `SUPABASE_SERVICE_ROLE_KEY` | Production, Sensitive |
| `CRON_SECRET` | Production, Sensitive |
| `SOFT_DELETE_RETENTION_DAYS` | Production (`30`) |
| `TRAINING_PREVIEW_ENABLED` | 교육용 Preview만 `true`, 운영은 `false` |
| `ENABLE_HSTS` | Production (단계 G 승인 후에만 `true`) |
| `NEXT_PUBLIC_SITE_URL` | Production (배포 URL 확정 후) |
| `NEXT_PUBLIC_CANONICAL_HOST`, `CANONICAL_REDIRECT_HOST` | Production (도메인 연결 후) |

`NEXT_PUBLIC_*`, canonical, HSTS는 빌드 시점에 번들에 들어간다. 값을 바꾸면 반드시
재배포해야 반영된다 — 기존 배포에 값만 추가해도 소용없다.

## migration으로 반영되지 않는 것

콘솔에서 사람이 직접 설정하고 확인해야 한다. `supabase/config.toml`은 hosted
프로젝트에 자동 반영되지 않는다.

- 공개 가입 차단 (`enable_signup = false`는 로컬 설정일 뿐이다)
- TOTP MFA 활성화
- Site URL과 `/auth/confirm` Redirect URL, Magic Link 템플릿(token-hash 형식)
- Data API exposed schema를 `public`만으로 제한
- `supabase/seed.example.sql` 기준 family 1건과 owner 초대 1건 생성

## 장애 대응

- **배포 실패**: 도메인을 새 deployment로 전환하지 않는다. Preview build/runtime 로그를
  본다. 환경변수는 이름과 scope만 확인하고 값을 티켓·채팅에 붙이지 않는다.
- **Migration 실패**: 더 이상 SQL을 실행하지 않는다. `supabase migration list` 결과와
  실패 로그를 보존하고 원인을 먼저 고친다. history repair로 즉석 복구하지 않는다.
- **Secret 노출**: 해당 키를 즉시 rotate → Vercel 환경변수 교체 → 재배포 → Git history와
  build 로그 잔존 여부 확인.

## 앱 구조 요점

- 로그인: 초대 이메일 + Magic Link + TOTP MFA. AAL1 세션은 `/auth/mfa`를 통과해야 한다.
  `middleware.ts`와 RLS(`private.has_aal2()`)가 AAL2를 이중으로 강제한다.
- Storage: `photos`/`thumbs` 모두 Private. 업로드는 service role이 발급한 signed upload
  token으로만, 조회는 signed URL로만. authenticated의 object insert/update/delete 정책은
  의도적으로 없다.
- 삭제: soft delete(`photos.deleted_at`) 후 Vercel Cron(`/api/cron/purge`, 매일 18:00 UTC)이
  service role로 정리한다. `CRON_SECRET` Bearer 헤더가 없으면 401.
- 데이터 계약은 `lib/contracts.ts`와 `lib/data/`, 업로드 파이프라인은 `lib/upload/pipeline.ts`.
