//! Who may use the server.
//!
//! - Bound to this computer only (no token): requests must name a loopback host in `Host`, which
//!   stops a web page from reaching the server through DNS rebinding.
//! - With an access token (always, when bound to the network): every `/api` request except
//!   `/api/health` and `/api/session` needs the token, as `Authorization: Bearer <token>` or the
//!   `spatt_access` cookie, unless it comes from this computer and names a loopback host.
//!   Opening any page with `?token=<token>` sets that cookie and redirects to the same page
//!   without the token, so an access link or QR code signs a browser in once.

use std::net::SocketAddr;

use axum::body::Body;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode, Uri};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::AppState;

pub const COOKIE: &str = "spatt_access";

/// A new random access token: 24 bytes as 48 hex digits.
pub fn generate_token() -> String {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).expect("the operating system's random source is unavailable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Compares in time independent of where the strings first differ.
pub fn tokens_match(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

fn presented_token(headers: &HeaderMap) -> Option<String> {
    if let Some(bearer) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        return Some(bearer.trim().to_owned());
    }
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, _)| *name == COOKIE)
        .map(|(_, value)| value.to_owned())
}

/// A request from this computer, addressed to this computer. Both halves matter: a page on
/// another site that rebinds its host name to 127.0.0.1 connects from loopback too, but its
/// `Host` header still names that site.
fn is_local(request: &Request) -> bool {
    let peer_is_loopback = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .is_some_and(|ConnectInfo(addr)| addr.ip().is_loopback());
    peer_is_loopback && host_name(request.headers()).is_some_and(|name| is_loopback_name(&name))
}

/// Local requests never need the token; others need it whenever one is set.
pub fn is_authorized(state: &AppState, request: &Request) -> bool {
    match &state.token {
        None => true,
        Some(_) if is_local(request) => true,
        Some(token) => {
            presented_token(request.headers()).is_some_and(|given| tokens_match(&given, token))
        }
    }
}

/// `Set-Cookie` for a valid token: HttpOnly, SameSite=Strict, for the whole site, one year.
pub fn access_cookie(token: &str) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000"
    ))
    .expect("tokens are hex")
}

fn host_name(headers: &HeaderMap) -> Option<String> {
    let host = headers.get(header::HOST)?.to_str().ok()?;
    let name = if let Some(rest) = host.strip_prefix('[') {
        // [::1]:8787
        rest.split(']').next()?.to_owned()
    } else {
        host.rsplit_once(':')
            .map_or(host, |(name, port)| {
                if port.chars().all(|c| c.is_ascii_digit()) {
                    name
                } else {
                    host
                }
            })
            .to_owned()
    };
    Some(name.to_ascii_lowercase())
}

fn is_loopback_name(name: &str) -> bool {
    name == "localhost"
        || name.ends_with(".localhost")
        || name
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
}

/// Applied to every request. Order: host check (no token), `?token=` sign-in, API token check.
pub async fn guard(State(state): State<AppState>, request: Request, next: Next) -> Response {
    if state.token.is_none()
        && !host_name(request.headers()).is_some_and(|name| is_loopback_name(&name))
    {
        return (
            StatusCode::MISDIRECTED_REQUEST,
            "This SPATT server only answers requests addressed to this computer (localhost).",
        )
            .into_response();
    }

    if let (Some(token), &Method::GET) = (&state.token, request.method()) {
        if let Some(redirect) = sign_in_redirect(token, request.uri()) {
            return redirect;
        }
    }

    let path = request.uri().path();
    let protected = path.starts_with("/api/") && path != "/api/health" && path != "/api/session";
    if protected && !is_authorized(&state, &request) {
        return unauthorized();
    }
    next.run(request).await
}

pub fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        [(header::CONTENT_TYPE, "application/json")],
        r#"{"error":"access-token-required"}"#,
    )
        .into_response()
}

/// `GET /page?token=<valid>&x=1` → 303 to `/page?x=1` with the access cookie. Anything else is
/// left alone (a wrong token simply does not sign in).
fn sign_in_redirect(token: &str, uri: &Uri) -> Option<Response> {
    let query = uri.query()?;
    let mut given = None;
    let rest: Vec<&str> = query
        .split('&')
        .filter(|pair| match pair.split_once('=') {
            Some(("token", value)) => {
                given = Some(value);
                false
            }
            _ => true,
        })
        .collect();
    if !tokens_match(given?, token) {
        return None;
    }
    let location = if rest.is_empty() {
        uri.path().to_owned()
    } else {
        format!("{}?{}", uri.path(), rest.join("&"))
    };
    Response::builder()
        .status(StatusCode::SEE_OTHER)
        .header(header::LOCATION, location)
        .header(header::SET_COOKIE, access_cookie(token))
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::empty())
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(header::HeaderName, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.append(name.clone(), HeaderValue::from_str(value).unwrap());
        }
        map
    }

    #[test]
    fn tokens_are_48_hex_digits_and_differ() {
        let a = generate_token();
        assert_eq!(a.len(), 48);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, generate_token());
    }

    #[test]
    fn reads_bearer_or_cookie() {
        assert_eq!(
            presented_token(&headers(&[(header::AUTHORIZATION, "Bearer abc")])).as_deref(),
            Some("abc")
        );
        assert_eq!(
            presented_token(&headers(&[(
                header::COOKIE,
                "theme=dark; spatt_access=xyz"
            )]))
            .as_deref(),
            Some("xyz")
        );
        assert_eq!(
            presented_token(&headers(&[(header::COOKIE, "other=1")])),
            None
        );
    }

    #[test]
    fn host_names() {
        let name = |h: &str| host_name(&headers(&[(header::HOST, h)]));
        assert_eq!(name("localhost:8787").as_deref(), Some("localhost"));
        assert_eq!(name("127.0.0.1:8787").as_deref(), Some("127.0.0.1"));
        assert_eq!(name("[::1]:8787").as_deref(), Some("::1"));
        assert_eq!(name("Evil.Example").as_deref(), Some("evil.example"));
        for ok in [
            "localhost",
            "app.localhost",
            "127.0.0.1",
            "127.8.0.1",
            "::1",
        ] {
            assert!(is_loopback_name(ok), "{ok}");
        }
        for bad in [
            "evil.example",
            "192.168.1.4",
            "localhost.evil.example",
            "0.0.0.0",
        ] {
            assert!(!is_loopback_name(bad), "{bad}");
        }
    }

    #[test]
    fn sign_in_link_redirects_without_the_token() {
        let token = "ab12";
        let response =
            sign_in_redirect(token, &"/index.html?x=1&token=ab12".parse().unwrap()).unwrap();
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        assert_eq!(response.headers()[header::LOCATION], "/index.html?x=1");
        let cookie = response.headers()[header::SET_COOKIE].to_str().unwrap();
        assert!(
            cookie.starts_with("spatt_access=ab12;")
                && cookie.contains("HttpOnly")
                && cookie.contains("SameSite=Strict")
        );
        assert!(sign_in_redirect(token, &"/?token=wrong".parse().unwrap()).is_none());
        assert!(sign_in_redirect(token, &"/?x=1".parse().unwrap()).is_none());
    }
}
