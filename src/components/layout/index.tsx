import type { PropsWithChildren } from "react";
import { Breadcrumb } from "../breadcrumb";
import { Menu } from "../menu";

export const Layout: React.FC<PropsWithChildren> = ({ children }) => {
  return (
    <div className="app-shell">
      <Menu />
      <main className="app-main">
        <Breadcrumb />
        <div className="app-content">{children}</div>
      </main>
    </div>
  );
};
