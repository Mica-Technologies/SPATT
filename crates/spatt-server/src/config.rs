//! `spatt-server.toml`, the headless server's settings file. Every key is optional; command-line
//! flags override the file.
//!
//! ```toml
//! bind = "0.0.0.0"          # "127.0.0.1" (default) serves this computer only
//! port = 8787
//! data_dir = "/srv/spatt"   # projects are kept in <data_dir>/projects
//! token = "…"               # required when bind is not a loopback address
//! ```

use std::net::IpAddr;
use std::path::{Path, PathBuf};

use serde::Deserialize;

#[derive(Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FileConfig {
    pub bind: Option<IpAddr>,
    pub port: Option<u16>,
    pub data_dir: Option<PathBuf>,
    pub token: Option<String>,
}

impl FileConfig {
    pub fn parse(text: &str) -> anyhow::Result<Self> {
        let config: FileConfig = toml::from_str(text)?;
        if let Some(token) = &config.token {
            validate_token(token)?;
        }
        Ok(config)
    }

    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let text = std::fs::read_to_string(path)
            .map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))?;
        Self::parse(&text).map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))
    }
}

/// Tokens travel in cookies and URLs, so they are limited to URL-safe characters.
pub fn validate_token(token: &str) -> anyhow::Result<()> {
    if token.len() < 16 {
        anyhow::bail!("the access token must be at least 16 characters");
    }
    if !token
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        anyhow::bail!("the access token may only contain letters, digits, '-' and '_'");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_key() {
        let config = FileConfig::parse(
            "bind = \"0.0.0.0\"\nport = 9000\ndata_dir = \"/srv/spatt\"\ntoken = \"abcdefghijklmnop\"\n",
        )
        .unwrap();
        assert_eq!(
            config,
            FileConfig {
                bind: Some("0.0.0.0".parse().unwrap()),
                port: Some(9000),
                data_dir: Some("/srv/spatt".into()),
                token: Some("abcdefghijklmnop".into()),
            }
        );
        assert_eq!(FileConfig::parse("").unwrap(), FileConfig::default());
    }

    #[test]
    fn rejects_unknown_keys_and_weak_tokens() {
        assert!(FileConfig::parse("prot = 1").is_err());
        assert!(FileConfig::parse("token = \"short\"").is_err());
        assert!(FileConfig::parse("token = \"has spaces in it here\"").is_err());
        assert!(FileConfig::parse("bind = \"not an ip\"").is_err());
    }
}
