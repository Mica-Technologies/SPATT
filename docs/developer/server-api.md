# Server API

`spatt-server` (`crates/spatt-server`) serves the web UI and a small JSON API over HTTP. The
desktop app runs the same router in-process. The web UI talks to it through `HttpStore`
(`src/io/http-store.ts`); other tools can use it too.

## Access

| Server binding | Who may call the API |
|---|---|
| This computer only (no token) | Requests whose `Host` names a loopback host (`localhost`, `127.0.0.1`, `[::1]`). Anything else gets `421`, which stops DNS-rebinding attacks from web pages. |
| The network (a token is required) | Requests from this computer that also name a loopback host, and any request with the token: `Authorization: Bearer <token>` or the `spatt_access` cookie. Others get `401 {"error":"access-token-required"}`. |

The cookie is set by opening any page with `?token=<token>` (the server answers `303` to the same
address without the token) or by `POST /api/session`. It is `HttpOnly`, `SameSite=Strict`,
and lasts a year. Replacing the token invalidates every cookie.

## Endpoints

| Request | Response |
|---|---|
| `GET /api/health` | `200 {"app":"spatt","version","tokenRequired"}`. Always open; the web UI uses it to recognise a SPATT server. |
| `GET /api/session` | `204` if this client may use the API, else `401`. |
| `POST /api/session` `{"token"}` | `204` with the access cookie, or `401`. |
| `GET /api/projects` | `200` project summaries `[{id, name, updatedAt, intersectionCount}]`, newest first. |
| `GET /api/projects/{id}` | `200` the project file text with an `ETag`, or `404`. |
| `PUT /api/projects/{id}` | Body: the project file text (at most 5 MB). See below. |
| `DELETE /api/projects/{id}` | `204`, optionally conditional on `If-Match`. |

Project ids match `^[a-z0-9][a-z0-9-]{0,62}$` (`400` otherwise); they are file names on the server.

## Versions and conflicts

A project's version is the FNV-1a 64-bit hash of its file text, as 16 hex digits
(`version_of` in `store.rs`, `versionOf` in `src/io/store.ts`), sent as a strong `ETag`.

Every `PUT` must say what it expects:

| Header | Meaning |
|---|---|
| `If-None-Match: *` | Create: the project must not exist. |
| `If-Match: "<version>"` | Update: the project must still be at the version this client last read or wrote. |
| `If-Match: *` | Overwrite whatever is there. |

Without one the server answers `428`. On success it answers `200 {"version"}` with the new
`ETag`. If the expectation does not hold it answers `412 {"error":"conflict"}` with the project's
current `ETag`, or no `ETag` if it was deleted. Writing exactly the text already stored always
succeeds, so a retried save is not a conflict.

The desktop app's own commands (`projects_write` in `src-tauri/src/projects.rs`) take the same
expectations and share the store's lock with the server, so the SPATT window and network browsers
are held to the same rule.
