"use client";

import { useEffect, useRef, useState } from "react";
import { logout as logoutSession } from "@/lib/api-client";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

type Mode = "loading" | "enroll" | "challenge" | "verifying" | "error";

export default function MfaPage() {
  const started = useRef(false);
  const [mode, setMode] = useState<Mode>("loading");
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("보안 상태를 확인하고 있습니다.");
  const [logoutBusy, setLogoutBusy] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      const supabase = createSupabaseBrowser();
      const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error) {
        setMode("error");
        setMessage("MFA 상태를 확인하지 못했습니다. 다시 로그인해 주세요.");
        return;
      }
      if (assurance.data.currentLevel === "aal2") {
        window.location.replace("/");
        return;
      }

      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) {
        setMode("error");
        setMessage("등록된 인증 수단을 확인하지 못했습니다.");
        return;
      }

      const verified = factors.data.totp.find((factor) => factor.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        setMode("challenge");
        setMessage("인증 앱에 표시된 6자리 코드를 입력하세요.");
        return;
      }

      // Discard incomplete enrollments so a refresh cannot accumulate factors.
      for (const factor of factors.data.totp.filter(
        (candidate) => candidate.status !== "verified",
      )) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }

      const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (enrolled.error) {
        setMode("error");
        setMessage("인증 앱 등록을 시작하지 못했습니다.");
        return;
      }
      setFactorId(enrolled.data.id);
      setQrCode(enrolled.data.totp.qr_code);
      setSecret(enrolled.data.totp.secret);
      setMode("enroll");
      setMessage("QR 코드를 인증 앱으로 스캔한 뒤 6자리 코드를 입력하세요.");
    })();
  }, []);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(normalized) || !factorId) {
      setMessage("6자리 숫자 코드를 입력하세요.");
      return;
    }

    setMode("verifying");
    const supabase = createSupabaseBrowser();
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error) {
      setMode("error");
      setMessage("인증 요청을 만들지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    const result = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code: normalized,
    });
    if (result.error) {
      setMode(qrCode ? "enroll" : "challenge");
      setMessage("코드가 올바르지 않거나 만료되었습니다. 새 코드를 입력하세요.");
      return;
    }
    window.location.replace("/");
  };

  const logout = async () => {
    if (logoutBusy) return;
    setLogoutBusy(true);
    try {
      await logoutSession();
      window.location.replace("/login");
    } catch {
      setMode("error");
      setMessage("로그아웃하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.");
      setLogoutBusy(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "var(--color-bg)",
        color: "var(--color-text)",
      }}
    >
      <section style={{ width: "min(420px, 100%)" }} aria-labelledby="mfa-title">
        <p style={{ fontWeight: 800, letterSpacing: ".08em" }}>SECURITY CHECK</p>
        <h1 id="mfa-title" style={{ marginTop: 8, fontSize: 28 }}>
          2단계 인증
        </h1>
        <p aria-live="polite" style={{ marginTop: 12, lineHeight: 1.6 }}>
          {message}
        </p>

        {mode === "enroll" && qrCode && (
          <div style={{ marginTop: 20 }}>
            {/* Supabase returns a data:image SVG generated for this factor. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrCode}
              alt="인증 앱 등록 QR 코드"
              width={220}
              height={220}
              style={{ display: "block", maxWidth: "100%", background: "white" }}
            />
            <p style={{ marginTop: 12, overflowWrap: "anywhere", fontSize: 13 }}>
              직접 입력 키: <code>{secret}</code>
            </p>
          </div>
        )}

        {(mode === "enroll" || mode === "challenge" || mode === "verifying") && (
          <form onSubmit={verify} style={{ marginTop: 20 }}>
            <label htmlFor="mfa-code" style={{ display: "block", fontWeight: 700 }}>
              인증 코드
            </label>
            <input
              id="mfa-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              disabled={mode === "verifying"}
              required
              style={{
                width: "100%",
                minHeight: 48,
                marginTop: 8,
                padding: "10px 12px",
                border: "2px solid currentColor",
                background: "transparent",
                color: "inherit",
                fontSize: 20,
                letterSpacing: ".2em",
              }}
            />
            <button
              type="submit"
              disabled={mode === "verifying"}
              style={{
                width: "100%",
                minHeight: 48,
                marginTop: 12,
                border: "2px solid currentColor",
                background: "var(--color-text)",
                color: "var(--color-bg)",
                fontWeight: 800,
              }}
            >
              {mode === "verifying" ? "확인 중…" : "인증하고 계속"}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={logout}
          disabled={logoutBusy}
          style={{
            minHeight: 44,
            marginTop: 16,
            border: 0,
            background: "transparent",
            color: "inherit",
            textDecoration: "underline",
          }}
        >
          {logoutBusy ? "로그아웃 중…" : "다른 계정으로 로그인"}
        </button>
      </section>
    </main>
  );
}
