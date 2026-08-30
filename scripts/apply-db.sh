#!/usr/bin/env bash
# Fresh Supabase project 전용 migration 적용 도우미.
# raw psql/DB URL을 사용하지 않고 Supabase CLI migration history를 유지한다.
# 이 스크립트는 migration만 적용하며 supabase/config.toml의 hosted 설정은 변경하지 않는다.
set -Eeuo pipefail

cd "$(dirname "$0")/.."

usage() {
  cat <<'EOF'
사용법:
  CONFIRM_FRESH_SUPABASE_PROJECT=YES_I_CREATED_A_NEW_PROJECT \
    ./scripts/apply-db.sh <project-ref>

이 스크립트는 이 앱만을 위해 방금 만든 빈 Supabase 프로젝트에만 사용합니다.
기존 운영 DB, 다른 앱의 테이블/트리거가 있는 DB, 복구가 필요한 DB에는 실행하지 마세요.
실제 키·DB URL·비밀번호를 .env 또는 ZIP으로 전달할 필요가 없습니다.
EOF
}

fail() {
  printf '오류: %s\n' "$1" >&2
  exit 1
}

on_error() {
  cat >&2 <<'EOF'

Migration 적용이 중단되었습니다.
- raw psql, SQL Editor 복붙, migration 재실행으로 임의 복구하지 마세요.
- `supabase migration list`로 상태를 확인하고, 교육용/빈 프로젝트라면 새 프로젝트에서 다시 시작하세요.
- 운영 데이터가 있는 프로젝트였다면 즉시 중단하고 백업·복구 담당자에게 인계하세요.
EOF
}
trap on_error ERR

if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

project_ref="$1"
if [[ ! "$project_ref" =~ ^[a-z0-9]{20}$ ]]; then
  fail "project-ref 형식이 올바르지 않습니다. Supabase Dashboard URL의 20자리 project ref를 사용하세요."
fi

if [[ "${CONFIRM_FRESH_SUPABASE_PROJECT:-}" != "YES_I_CREATED_A_NEW_PROJECT" ]]; then
  usage
  fail "fresh project 확인 문구가 없습니다. 기존 운영 DB 보호를 위해 중단합니다."
fi

command -v supabase >/dev/null 2>&1 || fail "Supabase CLI가 없습니다. 공식 문서대로 설치한 뒤 다시 실행하세요."

printf 'Supabase CLI: '
supabase --version

# CLI 버전별 플래그 차이를 조기에 발견한다.
supabase link --help >/dev/null
supabase migration list --help >/dev/null
supabase db push --help >/dev/null

cat <<EOF

대상 project ref: ${project_ref}
필수 사전 확인:
  1. 이 앱 전용으로 새로 만든 프로젝트다.
  2. public 스키마에 사용자 테이블이 없다.
  3. auth.users에 기존 사용자가 없고 Storage 객체도 없다.
  4. 프로젝트를 잘못 선택하면 즉시 중단한다.
EOF

supabase link --project-ref "$project_ref"

printf '\n== 현재 local/remote migration history ==\n'
supabase migration list

printf '\n== 적용 예정 migration dry-run ==\n'
supabase db push --dry-run

printf '\n계속하려면 project ref를 다시 입력하세요: '
read -r confirmation
if [[ "$confirmation" != "$project_ref" ]]; then
  fail "확인 값이 일치하지 않아 아무 변경 없이 중단합니다."
fi

printf '\n== Supabase CLI migration 적용 ==\n'
supabase db push

printf '\n== 적용 후 migration history ==\n'
supabase migration list

cat <<'EOF'

Migration 적용 완료.
다음 단계:
  1. db push는 supabase/config.toml을 hosted project에 반영하지 않았음을 확인
  2. 별도 승인 후 지원 CLI의 `supabase config push`를 사용하거나 Dashboard에서
     Data API exposed schema와 Auth signup-off를 수동 설정·검증
  3. Supabase SQL Editor에서 supabase/seed.example.sql을 참고해 family/owner를 1회 생성
  4. Auth Site URL/Redirect URL과 Magic Link 템플릿 설정
  5. photos/thumbs 버킷이 Private인지, RLS 정책이 존재하는지 확인
  6. Security Advisor를 실행하고 경고를 검토

실제 이메일·키·비밀번호를 소스, Git, ZIP에 저장하지 마세요.
EOF
