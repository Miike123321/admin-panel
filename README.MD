# admin-panel

<div align="center" style="margin: 30px;">
    <a href="https://refine.dev">
    <img alt="refine logo" src="https://refine.ams3.cdn.digitaloceanspaces.com/readme/refine-readme-banner.png">
    </a>
</div>
<br/>

This [Refine](https://github.com/refinedev/refine) project was generated with [create refine-app](https://github.com/refinedev/refine/tree/master/packages/create-refine-app).

## Getting Started

A React Framework for building internal tools, admin panels, dashboards & B2B apps with unmatched flexibility ✨

Refine's hooks and components simplifies the development process and eliminates the repetitive tasks by providing industry-standard solutions for crucial aspects of a project, including authentication, access control, routing, networking, state management, and i18n.

## Available Scripts

The development command starts both the Vite app and a local tasks API connected
to Neon via the server-only `DATABASE_URL` variable. The API listens on
`127.0.0.1:3001` by default; set `API_PORT` in `.env` to change it. Local
authentication is disabled unless `ADMIN_PASSWORD` is configured.
The API also initializes the task completion points table on startup. Assigned
responsibles earn 10 points the first time a task is completed; moving a task
out of "Done" and completing it again does not award duplicate points.

The **Settings** page stores Gemini, Superset MCP, and GitHub connection details
in the `admin_integration_settings` Neon table using AES-256-GCM encryption.
The encryption key is created locally at `~/.jarvis-admin/settings.key` with
owner-only permissions and is never stored in Neon or returned by the API.
Back up this key securely before moving the admin API to another host; without
it, saved integration credentials cannot be decrypted. Superset settings
currently support a remote HTTPS MCP endpoint and are intended for read-only
access.

Gemini is only used when **Help with description** is clicked in the task form.
The API sends the draft and up to 10 recent, non-sensitive tasks from the same
subsystem to the configured Gemini model; it does not send source files or
modify tasks. Sensitive payroll, personal, or payment-related task text is
blocked. The default helper model is `gemini-3.1-flash-lite`, which currently
has a free Gemini Developer API tier with model-specific limits. Google AI
subscriptions do not increase that API quota; API usage and data-handling terms
are separate. Check the AI Studio project and billing settings before use.

An AI-assigned task can be sent to GitHub with the **Copilot** action on its
card. The local API creates one GitHub issue per task and stores its URL. Open
the issue and assign GitHub Copilot in GitHub to start coding; issue creation
alone does not start the agent. Copilot works under the configured GitHub plan
and repository policies. It proposes changes in a PR for manual review; J.A.R.V.I.S.
does not automatically merge or deploy. The configured GitHub token needs
permission to create issues in the selected repository.

### Running the development server.

```bash
    npm run dev
```

### Building for production.

```bash
    npm run build
```

### Running the production server.

```bash
    npm run start
```

### Free hosting on Render

The repository includes a Render Blueprint for a single Node service that serves
the built app and API together. It uses the existing Neon database; no separate
static host or paid domain is needed. Render's free web service may sleep after
inactivity, so its first request after a pause can take longer. Render describes
free instances as suitable for hobby projects and testing, not business-critical
production workloads.

1. Push this repository to GitHub and sign in to [Render](https://render.com/).
2. In Render, choose **New → Blueprint**, select this GitHub repository, and
   apply the `render.yaml` configuration.
3. Enter the existing Neon connection string as `DATABASE_URL` in the private
   environment-variable form. Do not put it in this repository or share it in
   chat.
4. Set `ADMIN_PASSWORD` to a unique password of at least 16 characters. Render
   generates `SESSION_SECRET` and `JARVIS_SETTINGS_KEY`; keep those values
   stable. Changing `JARVIS_SETTINGS_KEY` makes previously saved integration
   credentials unreadable.
5. After the first successful deploy, open the Render service URL and sign in.
   Further pushes to the connected branch deploy automatically.

The production server refuses to start without `DATABASE_URL`,
`ADMIN_PASSWORD`, and a `SESSION_SECRET` of at least 32 characters. Keep the
generated secrets in Render's environment settings and back them up securely.
The health check at `/api/health` is public; application data and other API
routes require the administrator session.

## Learn More

To learn more about **Refine**, please check out the [Documentation](https://refine.dev/docs)

- **REST Data Provider** [Docs](https://refine.dev/docs/core/providers/data-provider/#overview)
- **React Router** [Docs](https://refine.dev/docs/core/providers/router-provider/)
- **Google Auth Provider** [Docs](https://refine.dev/docs/core/providers/auth-provider/)

## License

MIT
