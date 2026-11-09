import { ErrorComponent, Refine } from "@refinedev/core";
import React, { useEffect, useState } from "react";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";
import { BrowserRouter, Outlet, Route, Routes } from "react-router";
import routerProvider, {
  DocumentTitleHandler,
  NavigateToResource,
  UnsavedChangesNotifier,
} from "@refinedev/react-router";

import { Layout } from "./components/layout";
import "./App.css";
import { dataProvider } from "./providers/data";
import {
  BlogPostCreate,
  BlogPostEdit,
  BlogPostList,
  BlogPostShow,
} from "./pages/blog-posts";
import {
  CategoryCreate,
  CategoryEdit,
  CategoryList,
  CategoryShow,
} from "./pages/categories";
import { KanbanPage } from "./pages/kanban";
import { ResponsiblesPage } from "./pages/responsibles";
import { SettingsPage } from "./pages/settings";
import { API_URL } from "./providers/constants";

const AuthGate: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const checkSession = async () => {
    setIsChecking(true);
    try {
      const response = await fetch(`${API_URL}/auth/session`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Не удалось проверить вход.");
      setAuthRequired(result.required);
      setIsAuthenticated(!result.required || result.authenticated);
      setError("");
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "Нет соединения с сервером.");
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    void checkSession();
  }, []);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Не удалось войти.");
      setPassword("");
      setIsAuthenticated(true);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Не удалось войти.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      const response = await fetch(`${API_URL}/auth/logout`, { method: "POST" });
      if (!response.ok) throw new Error("Не удалось завершить сеанс.");
      setIsAuthenticated(false);
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Не удалось завершить сеанс.");
    }
  };

  if (isChecking) {
    return <div className="auth-screen" role="status">Проверяем доступ…</div>;
  }

  if (!isAuthenticated) {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={handleLogin}>
          <div className="brand-mark">J</div>
          <p className="page-eyebrow">ЗАЩИЩЁННЫЙ ДОСТУП</p>
          <h1>J.A.R.V.I.S</h1>
          <p>Введите пароль администратора, чтобы открыть рабочее пространство.</p>
          <label className="task-field">
            <span>Пароль</span>
            <input
              autoFocus
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="task-input"
            />
          </label>
          {error && <p className="task-create-error" role="alert">{error}</p>}
          <button className="modal-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Проверяем…" : "Войти"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <>
      {children}
      {authRequired && (
        <button className="auth-logout-button" type="button" onClick={() => void handleLogout()}>
          Выйти
        </button>
      )}
    </>
  );
};

function App() {
  return (
    <AuthGate>
    <BrowserRouter>
      <RefineKbarProvider>
        <Refine
            dataProvider={dataProvider}
            routerProvider={routerProvider}
            resources={[
              {
                name: "tasks",
                list: "/kanban",
                meta: { label: "Канбан-доска" },
              },
              {
                name: "responsibles",
                list: "/responsibles",
                meta: { label: "Ответственные" },
              },
              {
                name: "settings",
                list: "/settings",
                meta: { label: "Настройки" },
              },
              {
                name: "blog_posts",
                list: "/blog-posts",
                create: "/blog-posts/create",
                edit: "/blog-posts/edit/:id",
                show: "/blog-posts/show/:id",
                meta: { canDelete: true },
              },
              {
                name: "categories",
                list: "/categories",
                create: "/categories/create",
                edit: "/categories/edit/:id",
                show: "/categories/show/:id",
                meta: { canDelete: true },
              },
            ]}
            options={{
              syncWithLocation: true,
              warnWhenUnsavedChanges: true,
              projectId: "f5IdwA-xENKC8-vRTPZd",
            }}
          >
            <Routes>
              <Route element={<Layout><Outlet /></Layout>}>
                <Route index element={<NavigateToResource resource="tasks" />} />
                <Route path="/kanban" element={<KanbanPage />} />
                <Route path="/responsibles" element={<ResponsiblesPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/blog-posts">
                  <Route index element={<BlogPostList />} />
                  <Route path="create" element={<BlogPostCreate />} />
                  <Route path="edit/:id" element={<BlogPostEdit />} />
                  <Route path="show/:id" element={<BlogPostShow />} />
                </Route>
                <Route path="/categories">
                  <Route index element={<CategoryList />} />
                  <Route path="create" element={<CategoryCreate />} />
                  <Route path="edit/:id" element={<CategoryEdit />} />
                  <Route path="show/:id" element={<CategoryShow />} />
                </Route>
                <Route path="*" element={<ErrorComponent />} />
              </Route>
            </Routes>
            <RefineKbar />
            <UnsavedChangesNotifier />
            <DocumentTitleHandler />
        </Refine>
      </RefineKbarProvider>
    </BrowserRouter>
    </AuthGate>
  );
}

export default App;
