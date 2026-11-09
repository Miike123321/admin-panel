import { ErrorComponent, Refine } from "@refinedev/core";
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

function App() {
  return (
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
  );
}

export default App;
