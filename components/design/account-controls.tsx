"use client";

import { useState } from "react";
import { logout } from "@/lib/api-client";

type Props = {
  displayName: string;
  role: "owner" | "member";
};

type Feedback = { kind: "success" | "error"; message: string } | null;

export default function AccountControls({ displayName, role }: Props) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);

  const onLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setFeedback(null);
    try {
      await logout();
      window.location.replace("/login");
    } catch {
      setLoggingOut(false);
      setFeedback({
        kind: "error",
        message: "로그아웃하지 못했습니다. 잠시 후 다시 시도하세요.",
      });
    }
  };

  const onInvite = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inviting) return;
    setInviting(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/auth/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), displayName: name.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? `http_${response.status}`);
      }
      setEmail("");
      setName("");
      setFeedback({
        kind: "success",
        message: "가족을 초대했습니다. 초대받은 이메일로 로그인할 수 있어요.",
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "unknown";
      setFeedback({
        kind: "error",
        message:
          code === "already_invited"
            ? "이미 초대한 이메일입니다."
            : "초대하지 못했습니다. 이메일과 이름을 확인해 다시 시도하세요.",
      });
    } finally {
      setInviting(false);
    }
  };

  return (
    <details className="account-menu">
      <summary aria-label={`${displayName} 계정 메뉴`}>
        <span className="account-name">{displayName}</span>
        <span aria-hidden="true">＋</span>
      </summary>
      <div className="account-panel">
        <div className="account-panel-heading">
          <strong>{displayName}</strong>
          <span>{role === "owner" ? "OWNER" : "MEMBER"}</span>
        </div>

        {role === "owner" && (
          <form className="invite-form" onSubmit={onInvite} aria-busy={inviting}>
            <h2>가족 초대</h2>
            <label htmlFor="invite-name">이름</label>
            <input
              id="invite-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
            />
            <label htmlFor="invite-email">이메일</label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
            <button type="submit" disabled={inviting}>
              {inviting ? "초대 중…" : "초대하기"}
            </button>
          </form>
        )}

        {feedback && (
          <p
            className={`account-feedback ${feedback.kind}`}
            role={feedback.kind === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {feedback.message}
          </p>
        )}

        <button
          type="button"
          className="logout-button"
          onClick={onLogout}
          disabled={loggingOut}
          aria-busy={loggingOut}
        >
          {loggingOut ? "로그아웃 중…" : "로그아웃"}
        </button>
      </div>
    </details>
  );
}
