"use client";

import { useState } from "react";
import { logout as logoutSession } from "@/lib/api-client";

export default function AccessDeniedPage() {
  const [busy, setBusy] = useState(false);
  const [logoutError, setLogoutError] = useState(false);

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    setLogoutError(false);
    try {
      await logoutSession();
      window.location.replace("/login");
    } catch {
      setBusy(false);
      setLogoutError(true);
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
      <section style={{ width: "min(420px, 100%)" }} aria-labelledby="access-title">
        <p style={{ fontWeight: 800, letterSpacing: ".08em" }}>ACCESS CHECK</p>
        <h1 id="access-title" style={{ marginTop: 8, fontSize: 28 }}>
          접근 권한을 확인해 주세요
        </h1>
        <p style={{ marginTop: 12, lineHeight: 1.6 }}>
          이 계정에는 현재 가족 보관함 접근 권한이 없습니다. 초대한 관리자에게
          문의하거나 다른 계정으로 로그인해 주세요.
        </p>
        <button
          type="button"
          onClick={logout}
          disabled={busy}
          style={{
            width: "100%",
            minHeight: 48,
            marginTop: 20,
            border: "2px solid currentColor",
            background: "var(--color-text)",
            color: "var(--color-bg)",
            fontWeight: 800,
          }}
        >
          {busy ? "로그아웃 중…" : "다른 계정으로 로그인"}
        </button>
        {logoutError && (
          <p role="alert" style={{ marginTop: 12, lineHeight: 1.5 }}>
            로그아웃하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.
          </p>
        )}
      </section>
    </main>
  );
}
