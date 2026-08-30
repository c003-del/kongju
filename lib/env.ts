// 미확정 슬롯은 환경변수로만 참조한다. 값이 없으면 명확한 오류를 던진다.
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `환경변수 ${name} 가 설정되지 않았습니다. .env.local 또는 Vercel 환경변수를 확인하세요.`,
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL");
}

export function supabaseAnonKey(): string {
  return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export function supabaseServiceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY");
}

export function softDeleteRetentionDays(): number {
  const raw = process.env.SOFT_DELETE_RETENTION_DAYS;
  const days = raw ? Number(raw) : 30;
  return Number.isSafeInteger(days) && days >= 1 && days <= 3650 ? days : 30;
}

export function siteUrl(fallbackOrigin: string): string {
  return process.env.NEXT_PUBLIC_SITE_URL || fallbackOrigin;
}
