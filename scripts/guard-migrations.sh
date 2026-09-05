#!/usr/bin/env bash
# main 머지로 DB 데이터가 사라지는 경로를 차단하는 게이트.
#
# `supabase db push`는 remote history에 없는 migration 파일만 앞으로 적용하며,
# DB를 reset 하거나 이미 적용된 migration을 다시 실행하지 않는다. 따라서 자동
# 적용의 유일한 데이터 손실 경로는 "파괴적 SQL이 담긴 새 migration이 머지되는
# 것"이다. 이 스크립트가 그 경로를 막는다.
#
#   1. 이미 적용된 migration 파일의 수정/삭제/이름변경 → 실패
#      (db push가 조용히 건너뛰어 로컬과 원격 history가 어긋난다)
#   2. 새 migration 파일의 파괴적 SQL → 실패
#      ALLOW_DESTRUCTIVE=1 일 때만 통과한다. 워크플로는 push(머지) 트리거에서는
#      이 값을 절대 설정하지 않고, 사람이 project ref를 직접 입력한
#      workflow_dispatch 에서만 설정한다.
#
# 사용법: scripts/guard-migrations.sh [<base-sha> [<head-sha>]]
set -Eeuo pipefail

cd "$(dirname "$0")/.."

MIGRATION_DIR="supabase/migrations"
base_sha="${1:-}"
head_sha="${2:-HEAD}"
allow_destructive="${ALLOW_DESTRUCTIVE:-0}"

fail() {
  printf '::error::%s\n' "$1" >&2
  exit 1
}

# 데이터를 지우거나 되돌릴 수 없게 만드는 구문만 나열한다.
# `drop policy` / `drop trigger` / `drop function` 은 데이터 손실이 아니므로
# 제외한다 (20260830000005_storage_harden.sql 이 정상적으로 drop policy 를 쓴다).
DESTRUCTIVE_RE='(^|[^a-z_])(drop[[:space:]]+(table|schema|database|column|owned|tablespace|type|extension|(materialized[[:space:]]+)?view)|truncate([[:space:]]+table)?[[:space:]]|delete[[:space:]]+from|drop[[:space:]]+constraint)([^a-z_]|$)'

# `-- ` 라인 주석과 CREATE FUNCTION/PROCEDURE 본문(달러 인용 블록)을 지운다.
# 함수 본문의 `delete from` 은 migration 적용 시점에 실행되지 않으므로 검사
# 대상이 아니다. 반대로 `do $$ ... $$;` 블록은 즉시 실행되므로 남겨 둔다.
# 줄 번호를 유지하기 위해 입력 1줄당 출력 1줄을 낸다.
normalize() {
  sed -e 's/--.*$//' "$1" | awk '
    BEGIN { intag = ""; pending = ""; strip = 0 }
    {
      line = $0; out = "";
      while (length(line) > 0) {
        if (intag == "") {
          if (match(line, /\$[A-Za-z_0-9]*\$/)) {
            pre = substr(line, 1, RSTART - 1);
            out = out pre;
            n = split(pre, parts, ";");
            pending = pending parts[1];
            for (i = 2; i <= n; i++) pending = parts[i];
            strip = (tolower(pending) ~ /(function|procedure)/);
            intag = substr(line, RSTART, RLENGTH);
            line = substr(line, RSTART + RLENGTH);
          } else {
            out = out line;
            n = split(line, parts, ";");
            pending = pending parts[1];
            for (i = 2; i <= n; i++) pending = parts[i];
            pending = pending " ";
            line = "";
          }
        } else {
          idx = index(line, intag);
          if (idx > 0) {
            if (!strip) out = out substr(line, 1, idx - 1);
            line = substr(line, idx + length(intag));
            intag = ""; pending = ""; strip = 0;
          } else {
            if (!strip) out = out line;
            line = "";
          }
        }
      }
      print out;
    }'
}

scan_file() {
  local file="$1" hits
  hits="$(normalize "$file" | grep -n -i -E "$DESTRUCTIVE_RE" || true)"
  if [[ -n "$hits" ]]; then
    printf '%s\n%s\n' "$file" "$hits" >&2
    return 1
  fi
  return 0
}

changed=""
if [[ -n "$base_sha" && "$base_sha" != "0000000000000000000000000000000000000000" ]] \
   && git cat-file -e "${base_sha}^{commit}" 2>/dev/null; then
  changed="$(git diff --name-status --diff-filter=AMDR "$base_sha" "$head_sha" -- "$MIGRATION_DIR" || true)"
else
  # base 커밋을 알 수 없으면(첫 실행, force push, 수동 실행) 안전한 쪽으로
  # 추적 중인 migration 전체를 새 파일처럼 검사한다.
  printf '알림: base 커밋을 확인할 수 없어 %s 전체를 검사합니다.\n' "$MIGRATION_DIR"
  while IFS= read -r f; do
    [[ -n "$f" ]] && changed+=$'A\t'"$f"$'\n'
  done < <(git ls-files "$MIGRATION_DIR/*.sql")
fi

if [[ -z "${changed//[$'\n\t ']/}" ]]; then
  printf 'migration 변경 없음. 게이트 통과.\n'
  exit 0
fi

immutable_violations=()
added_files=()

while IFS=$'\t' read -r status path rest; do
  [[ -z "${status:-}" ]] && continue
  case "$status" in
    A)   added_files+=("$path") ;;
    M|D) immutable_violations+=("$status $path") ;;
    R*)  immutable_violations+=("$status $path -> ${rest:-?}") ;;
  esac
done <<< "$changed"

if (( ${#immutable_violations[@]} > 0 )); then
  printf '이미 적용된 migration 파일이 변경/삭제되었습니다:\n' >&2
  printf '  %s\n' "${immutable_violations[@]}" >&2
  fail 'migration history는 append-only입니다. 기존 파일을 고치지 말고 새 migration을 추가하세요.'
fi

destructive=()
for f in "${added_files[@]}"; do
  [[ "$f" == *.sql ]] || continue
  [[ -f "$f" ]] || continue
  if ! scan_file "$f"; then
    destructive+=("$f")
  fi
done

if (( ${#destructive[@]} > 0 )); then
  if [[ "$allow_destructive" == "1" ]]; then
    printf '::warning::파괴적 migration이 명시적 승인으로 통과했습니다: %s\n' "${destructive[*]}"
  else
    fail "파괴적 SQL이 포함된 새 migration이 있습니다: ${destructive[*]} — main 머지로는 자동 적용되지 않습니다. 백업을 확인한 뒤 Actions에서 'Deploy Supabase migrations'를 수동 실행하고 project ref를 직접 입력하세요."
  fi
fi

printf '게이트 통과: 새 migration %d개, 파괴적 구문 %d개.\n' "${#added_files[@]}" "${#destructive[@]}"
