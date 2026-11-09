import { useMenu } from "@refinedev/core";
import { NavLink } from "react-router";

export const Menu = () => {
  const { menuItems } = useMenu();

  return (
    <nav className="app-sidebar" aria-label="Основная навигация">
      <NavLink className="sidebar-brand" to="/kanban">
        <span className="brand-mark">J</span>
        <span>
          <strong>J.A.R.V.I.S</strong>
          <small>WORKSPACE</small>
        </span>
      </NavLink>

      <div className="sidebar-section-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <ul className="sidebar-nav">
        {menuItems.map((item) => {
          const route = item.route ?? "/";
          const icon =
            route === "/kanban"
              ? "▦"
              : route === "/responsibles"
                ? "🏁"
                : route === "/settings"
                  ? "⚙"
                : route.includes("blog")
                  ? "▤"
                  : "◈";

          return (
            <li key={item.key}>
              <NavLink
                to={route}
                className={({ isActive }) =>
                  `sidebar-link${isActive ? " active" : ""}`
                }
              >
                <span className="sidebar-icon" aria-hidden="true">
                  {icon}
                </span>
                <span>{item.label}</span>
                {route === "/kanban" && (
                  <span className="sidebar-live-dot" aria-label="Активно" />
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>

      <div className="sidebar-bottom">
        <div className="sidebar-status">
          <span className="status-indicator" />
          <span>
            <strong>Все системы работают</strong>
            <small>Подключение активно</small>
          </span>
        </div>
        <div className="sidebar-profile">
          <span className="profile-avatar">J</span>
          <span>
            <strong>Администратор</strong>
            <small>Панель управления</small>
          </span>
          <span className="profile-menu" aria-hidden="true">···</span>
        </div>
      </div>
    </nav>
  );
};
