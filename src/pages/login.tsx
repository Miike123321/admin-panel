import { useEffect, useRef, useState } from "react";
import { useLogin } from "@refinedev/core";

import { CredentialResponse } from "../interfaces/google";

const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID;

let googleScriptLoad: Promise<void> | undefined;

const loadGoogleIdentityServices = (): Promise<void> => {
  if (window.google) {
    return Promise.resolve();
  }

  if (!googleScriptLoad) {
    googleScriptLoad = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (window.google) {
          resolve();
        } else {
          reject(new Error("Google Sign-In did not initialize."));
        }
      };
      script.onerror = () => reject(new Error("Google Sign-In could not load."));
      document.head.appendChild(script);
    });
  }

  return googleScriptLoad;
};

export const Login: React.FC = () => {
  const { mutate: login } = useLogin<CredentialResponse>();
  const loginRef = useRef(login);
  const buttonRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string>();
  loginRef.current = login;

  useEffect(() => {
    let active = true;

    if (!GOOGLE_CLIENT_ID) {
      setLoadError(
        "Не задан VITE_GOOGLE_CLIENT_ID. Добавьте ID клиента Google в .env и перезапустите сервер."
      );
      return () => {
        active = false;
      };
    }

    loadGoogleIdentityServices()
      .then(() => {
        if (!active || !buttonRef.current) {
          return;
        }

        window.google.accounts.id.initialize({
          ux_mode: "popup",
          client_id: GOOGLE_CLIENT_ID,
          callback: (response: CredentialResponse) => {
            if (response.credential) {
              loginRef.current(response);
            }
          },
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: "filled_blue",
          size: "medium",
          type: "standard",
        });
      })
      .catch((error: unknown) => {
        if (active) {
          console.error("Failed to load Google Sign-In.", error);
          setLoadError(
            "Не удалось загрузить вход через Google. Обновите страницу и попробуйте снова."
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <h1>Вход в панель управления</h1>
      <p>Войдите через Google, чтобы открыть запрошенную страницу.</p>
      <div ref={buttonRef} />
      {loadError && <p role="alert">{loadError}</p>}
      <p>
        Powered by
        <img
          style={{ padding: "0 5px" }}
          alt="Google"
          src="https://refine.ams3.cdn.digitaloceanspaces.com/superplate-auth-icons%2Fgoogle.svg"
        />
        Google
      </p>
    </div>
  );
};
