//! The project API, mirroring `ProjectStore` in `src/io/store.ts` (see `src/io/http-store.ts`).
//!
//! | Request | Result |
//! |---|---|
//! | `GET /api/projects` | `200` summaries, newest first |
//! | `GET /api/projects/{id}` | `200` file text with `ETag`, or `404` |
//! | `PUT /api/projects/{id}` + `If-Match: "<version>"` or `If-None-Match: *` | `200 {"version"}` with `ETag`; `412` if the project changed (its current `ETag`, if any); `428` without a condition |
//! | `DELETE /api/projects/{id}` [+ `If-Match`] | `204`; `412` if it changed |
//! | `GET /api/session` | `204` when this browser may use the API, else `401` |
//! | `POST /api/session` `{"token"}` | `204` and the access cookie, or `401` |
//!
//! Versions are content hashes (`store::version_of`), sent as strong entity tags.

use axum::body::Bytes;
use axum::extract::{Path, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::auth;
use crate::store::{Expected, StoreError};
use crate::AppState;

/// Projects are tens of kilobytes; anything near this is not a project.
pub const MAX_PROJECT_BYTES: usize = 5 * 1024 * 1024;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/projects", get(list))
        .route("/projects/{id}", get(read).put(write).delete(remove))
        .route("/session", get(session).post(sign_in))
}

fn etag(version: &str) -> HeaderValue {
    HeaderValue::from_str(&format!("\"{version}\"")).expect("versions are hex")
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    error: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn error(status: StatusCode, code: &str, message: Option<String>) -> Response {
    (
        status,
        Json(ErrorBody {
            error: code,
            message,
        }),
    )
        .into_response()
}

fn store_error(err: StoreError) -> Response {
    match err {
        StoreError::InvalidId(_) => {
            error(StatusCode::BAD_REQUEST, "invalid-id", Some(err.to_string()))
        }
        StoreError::Conflict { current } => {
            let mut response = error(StatusCode::PRECONDITION_FAILED, "conflict", None);
            if let Some(version) = current {
                response.headers_mut().insert(header::ETAG, etag(&version));
            }
            response
        }
        StoreError::Io(io) => {
            tracing::error!("project store: {io}");
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "store",
                Some(io.to_string()),
            )
        }
    }
}

/// Store calls touch the disk, so they run on the blocking pool.
async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, StoreError> + Send + 'static,
) -> Result<T, Box<Response>> {
    tokio::task::spawn_blocking(job)
        .await
        .map_err(|join| {
            Box::new(error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "task",
                Some(join.to_string()),
            ))
        })?
        .map_err(|e| Box::new(store_error(e)))
}

async fn list(State(state): State<AppState>) -> Response {
    let store = state.store.clone();
    match blocking(move || store.list()).await {
        Ok(summaries) => Json(summaries).into_response(),
        Err(response) => *response,
    }
}

async fn read(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let store = state.store.clone();
    match blocking(move || store.read_versioned(&id)).await {
        Ok(Some((text, version))) => (
            [
                (
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("application/json"),
                ),
                (header::ETAG, etag(&version)),
                (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
            ],
            text,
        )
            .into_response(),
        Ok(None) => error(StatusCode::NOT_FOUND, "not-found", None),
        Err(response) => *response,
    }
}

/// `If-Match: "v"` → that version; `If-None-Match: *` → must not exist; neither → `None`.
fn condition(headers: &HeaderMap) -> Result<Option<Expected<'_>>, Box<Response>> {
    if let Some(value) = headers.get(header::IF_MATCH) {
        let value = value.to_str().unwrap_or_default().trim();
        if value == "*" {
            return Ok(Some(Expected::Any));
        }
        return match value.strip_prefix('"').and_then(|v| v.strip_suffix('"')) {
            Some(version) => Ok(Some(Expected::Version(version))),
            None => Err(Box::new(error(
                StatusCode::BAD_REQUEST,
                "bad-if-match",
                None,
            ))),
        };
    }
    if headers.get(header::IF_NONE_MATCH).is_some_and(|v| v == "*") {
        return Ok(Some(Expected::Absent));
    }
    Ok(None)
}

async fn write(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let expected = match condition(&headers) {
        Ok(Some(expected)) => owned(expected),
        Ok(None) => {
            return error(
                StatusCode::PRECONDITION_REQUIRED,
                "condition-required",
                Some("send If-Match with the version you read, If-Match: * to overwrite, or If-None-Match: * to create".into()),
            )
        }
        Err(response) => return *response,
    };
    if body.len() > MAX_PROJECT_BYTES {
        return error(StatusCode::PAYLOAD_TOO_LARGE, "too-large", None);
    }
    let Ok(text) = String::from_utf8(body.to_vec()) else {
        return error(StatusCode::BAD_REQUEST, "not-utf8", None);
    };
    let store = state.store.clone();
    match blocking(move || store.write_if(&id, &text, expected.as_expected())).await {
        Ok(version) => {
            let mut response = Json(serde_json::json!({ "version": version })).into_response();
            response.headers_mut().insert(header::ETAG, etag(&version));
            response
        }
        Err(response) => *response,
    }
}

async fn remove(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let expected = match condition(&headers) {
        Ok(expected) => owned(expected.unwrap_or(Expected::Any)),
        Err(response) => return *response,
    };
    let store = state.store.clone();
    match blocking(move || store.remove_if(&id, expected.as_expected())).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(response) => *response,
    }
}

/// `Expected` borrows the header; this carries it onto the blocking pool.
enum OwnedExpected {
    Any,
    Absent,
    Version(String),
}

fn owned(expected: Expected<'_>) -> OwnedExpected {
    match expected {
        Expected::Any => OwnedExpected::Any,
        Expected::Absent => OwnedExpected::Absent,
        Expected::Version(v) => OwnedExpected::Version(v.to_owned()),
    }
}

impl OwnedExpected {
    fn as_expected(&self) -> Expected<'_> {
        match self {
            OwnedExpected::Any => Expected::Any,
            OwnedExpected::Absent => Expected::Absent,
            OwnedExpected::Version(v) => Expected::Version(v),
        }
    }
}

async fn session(State(state): State<AppState>, request: Request) -> Response {
    if auth::is_authorized(&state, &request) {
        StatusCode::NO_CONTENT.into_response()
    } else {
        auth::unauthorized()
    }
}

#[derive(Deserialize)]
struct SignIn {
    token: String,
}

async fn sign_in(State(state): State<AppState>, Json(body): Json<SignIn>) -> Response {
    match &state.token {
        None => StatusCode::NO_CONTENT.into_response(),
        Some(token) if auth::tokens_match(body.token.trim(), token) => (
            StatusCode::NO_CONTENT,
            [(header::SET_COOKIE, auth::access_cookie(token))],
        )
            .into_response(),
        Some(_) => auth::unauthorized(),
    }
}
