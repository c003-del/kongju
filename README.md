# Kongjuworld v2.1 — 교육용 배포 패키지

가족 사진을 비공개로 보관하는 Next.js(App Router) + Supabase + Vercel 예제입니다.
사진 업로드, 타임라인, 앨범, 인물·태그, 즐겨찾기, 댓글·반응 API와 private Storage/RLS 예제를 포함합니다.

> **중요: 이 패키지는 새 Supabase 프로젝트 전용입니다.**
>
> 기존 운영 DB의 업그레이드·마이그레이션 패키지가 아닙니다. 이미 테이블, Auth 사용자,
> Storage 객체 또는 migration history가 있는 프로젝트에는 migration이나
> `scripts/apply-db.sh`를 실행하지 마세요. 운영 서비스에 적용하려면 별도의 호환 migration,
> 데이터 이관, 백업 및 rollback 계획이 필요합니다.

## 시작하기 전에

- 실제 API 키·이메일·DB URL·비밀번호가 든 `.env*` 파일을 Git, ZIP 또는 메신저로 전달하지 않습니다.
- 공개 가능한 변수 이름은 [`.env.example`](.env.example)에서만 관리합니다.
- Supabase 키는 로컬의 `.env.local`과 Vercel Project Settings에 직접 입력합니다.
- `/training-preview`는 샘플 데이터만 쓰는 read-only `demoMode` 직원 연습 화면입니다.
  `TRAINING_PREVIEW_ENABLED=true`인 환경에서만 열고, 운영은 `false` 또는 미설정으로 두어 404가
  반환되게 합니다.
- 이 앱의 사용자 로그인은 **초대 이메일 + Magic Link + TOTP MFA** 방식입니다. Magic Link로 만든
  AAL1 세션은 `/auth/mfa`에서 등록 또는 challenge를 완료해야 하며, middleware와 RLS가 AAL2를
  이중으로 강제합니다.
- Supabase/Vercel/GitHub 관리자 계정 자체에는 MFA를 활성화하세요.

## 안전한 빠른 시작

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
# .env.local에 본인의 새 Supabase 프로젝트 값 입력
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

DB migration은 raw `psql`이나 SQL Editor 복붙 대신 Supabase CLI history로 관리합니다.

```bash
supabase login

# 선택: Docker 기반 로컬 Supabase에서 migration 전체 체인 재현
supabase start
supabase db reset

# 방금 만든 빈 원격 프로젝트에만 적용
CONFIRM_FRESH_SUPABASE_PROJECT=YES_I_CREATED_A_NEW_PROJECT \
  ./scripts/apply-db.sh <project-ref>
```

`supabase db push`는 hosted 프로젝트에 `supabase/config.toml`의 Auth/Data API 설정을 반영하지
않습니다. 별도 승인 아래 지원 CLI의 `supabase config push`를 실행하거나 Dashboard에서 공개 가입
차단과 exposed schema를 직접 설정·검증하세요.

그 다음 Supabase SQL Editor에서 `supabase/seed.example.sql`을 참고해 owner를 1회 생성하고,
Auth URL/Magic Link, private Storage, Vercel 환경변수와 Cron을 설정합니다.

## 문서

- [설치·보안·배포 절차](docs/SETUP.md)
- [교육용 인수인계 및 운영 체크리스트](docs/HANDOVER.md)
- [전달 전 검증 기록과 수령 후 통합 검사](docs/VERIFICATION.md)
- DB schema/RLS/Storage 정책: `supabase/migrations/`의 5개 migration
- 데이터 계약: `lib/contracts.ts`, `lib/data/`
- 업로드 파이프라인: `lib/upload/pipeline.ts`
- Vercel Cron: `vercel.json` → `/api/cron/purge`, 매일 18:00 UTC(KST 03:00)

## 배포 승인 기준

- migration 5개가 새 프로젝트의 remote history에 모두 기록됨
- hosted Data API/Auth 설정을 별도 반영하고 공개 가입 차단·exposed schema 범위를 확인함
- `photos`와 `thumbs` 버킷이 모두 Private이며 public URL로 노출되지 않음
- 공개 가입 차단, Magic Link redirect, owner 초대가 확인됨
- 첫 로그인 TOTP 등록, 다음 로그인 challenge, AAL1 UI/API/DB/Storage 차단이 확인됨
- Vercel에 secret을 직접 등록하고 ZIP/Git에 실제 값이 없음
- 비인증 접근 차단, signed URL, 업로드·중복 방지·soft delete·Cron을 확인함
- CSP, noindex, security headers와 canonical redirect가 응답에서 확인됨
- 운영에서 `/training-preview`가 404이고 교육용 Preview에서만 명시적으로 활성화됨
- TOTP 분실 복구 담당자·신원 확인·승인 기록 절차가 지정됨

검증을 마치기 전에는 프로덕션 도메인을 연결하거나 기존 서비스를 교체하지 마세요.
