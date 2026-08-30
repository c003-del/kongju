"use client";
import { useEffect, useState } from "react";
import { login, logout as logoutSession } from "@/lib/api-client";

type Status = "idle" | "sending" | "sent" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [mfaRecovery, setMfaRecovery] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryFailed, setRecoveryFailed] = useState(false);

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    if (error) {
      setStatus("error");
      setMfaRecovery(error === "mfa");
    }
  }, []);

  const resetSession = async () => {
    if (recoveryBusy) return;
    setRecoveryBusy(true);
    setRecoveryFailed(false);
    try {
      await logoutSession();
      window.location.replace("/login");
    } catch {
      setRecoveryBusy(false);
      setRecoveryFailed(true);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || status === "sending") return;
    setStatus("sending");
    try {
      await login(email.trim());
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <form onSubmit={submit} style={{ width: "min(360px, 100%)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
          <span
            aria-hidden="true"
            style={{
              width: "12px",
              height: "12px",
              background: "var(--color-accent)",
              display: "inline-block",
              transform: "translateY(1px)",
            }}
          ></span>
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 800,
              fontSize: "18px",
              letterSpacing: "-0.01em",
              textTransform: "uppercase",
              margin: 0,
            }}
          >
            FAMILY PHOTO
          </h1>
        </div>
        <div className="rulewrap" style={{ marginTop: "16px" }}>
          <div className="rule in"></div>
        </div>
        <label
          htmlFor="email"
          style={{
            display: "block",
            marginTop: "24px",
            fontSize: "13px",
            fontWeight: 700,
            letterSpacing: "0.04em",
          }}
        >
          이메일
        </label>
        <p
          id="login-help"
          style={{ margin: "8px 0 0", fontSize: "13px", lineHeight: 1.5 }}
        >
          초대받은 이메일을 입력하면 비밀번호 없이 로그인 링크를 보내드려요.
        </p>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          aria-describedby="login-help"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{
            display: "block",
            width: "100%",
            marginTop: "8px",
            border: "2px solid var(--color-text)",
            background: "transparent",
            color: "var(--color-text)",
            fontSize: "16px",
            fontFamily: "var(--font-body)",
            padding: "12px 14px",
            minHeight: "44px",
          }}
        />
        <button
          type="submit"
          disabled={status === "sending"}
          aria-busy={status === "sending"}
          style={{
            marginTop: "16px",
            width: "100%",
            border: "2px solid var(--color-text)",
            background: "var(--color-text)",
            color: "var(--color-bg)",
            fontWeight: 700,
            fontSize: "14px",
            padding: "12px 22px",
            cursor: "pointer",
            minHeight: "44px",
            letterSpacing: "0.04em",
          }}
        >
          {status === "sending" ? "로그인 링크 보내는 중…" : "로그인 링크 보내기"}
        </button>
        <div aria-live="polite" aria-atomic="true">
          {status === "sent" && (
            <p style={{ marginTop: "16px", fontSize: "13px", fontWeight: 600 }}>
              로그인 링크를 보냈습니다. 메일함을 확인하세요.
            </p>
          )}
          {status === "error" && (
            <>
              <p
                role="alert"
                style={{
                  marginTop: "16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--color-accent-700)",
                }}
              >
                {mfaRecovery
                  ? "2단계 인증 상태를 확인하지 못했습니다. 세션을 초기화한 뒤 다시 로그인하세요."
                  : "로그인에 실패했습니다. 다시 시도하세요."}
              </p>
              {mfaRecovery && (
                <button
                  type="button"
                  onClick={resetSession}
                  disabled={recoveryBusy}
                  style={{
                    marginTop: "12px",
                    width: "100%",
                    border: "2px solid var(--color-text)",
                    background: "transparent",
                    color: "var(--color-text)",
                    fontWeight: 700,
                    padding: "12px 22px",
                    minHeight: "44px",
                  }}
                >
                  {recoveryBusy
                    ? "세션 초기화 중…"
                    : "세션 초기화 · 다른 계정으로 로그인"}
                </button>
              )}
              {mfaRecovery && recoveryFailed && (
                <p role="alert" style={{ marginTop: "10px", fontSize: "13px" }}>
                  세션을 초기화하지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요.
                </p>
              )}
            </>
          )}
        </div>
      </form>
    </main>
  );
}
