import type { NextConfig } from "next";

const remotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [];
const isDevelopment = process.env.NODE_ENV === "development";
let supabaseOrigin = "";

// Supabase Storage 도메인은 빌드 환경변수에서 유도한다.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (supabaseUrl) {
  try {
    const { hostname, port, protocol } = new URL(supabaseUrl);
    const isLocalHttp =
      isDevelopment &&
      protocol === "http:" &&
      (hostname === "127.0.0.1" || hostname === "localhost");
    if (protocol !== "https:" && !isLocalHttp) {
      throw new Error("Supabase URL must use HTTPS outside local development");
    }
    remotePatterns.push({
      protocol: protocol === "http:" ? "http" : "https",
      hostname,
      port,
      pathname: "/storage/v1/**",
    });
    supabaseOrigin = `${protocol}//${hostname}${port ? `:${port}` : ""}`;
  } catch {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL must be HTTPS or a local development URL",
    );
  }
}

function optionalHostname(name: string): string {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  if (!value) return "";
  const hostname =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
  if (!hostname.test(value)) {
    throw new Error(`${name} must contain a hostname only (no scheme, port, or path)`);
  }
  return value;
}

const canonicalHost = optionalHostname("NEXT_PUBLIC_CANONICAL_HOST");
const canonicalRedirectHost = optionalHostname("CANONICAL_REDIRECT_HOST");
const enableHsts = process.env.ENABLE_HSTS === "true";

// 이 앱은 inline-style 기반 디자인과 Next.js hydration script를 사용한다.
// 따라서 style/script의 unsafe-inline은 현재 렌더링 호환을 위한 제한적 예외다.
// nonce 기반 CSP를 도입할 때 두 예외를 제거한다.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  `media-src 'self' blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin} ${supabaseOrigin.replace(/^http/, "ws")}` : ""}`,
  `frame-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
  ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive, nosnippet, noimageindex",
  },
  ...(enableHsts
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { remotePatterns },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    if (
      !canonicalHost ||
      !canonicalRedirectHost ||
      canonicalHost === canonicalRedirectHost
    ) {
      return [];
    }
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: canonicalRedirectHost }],
        destination: `https://${canonicalHost}/:path*`,
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
