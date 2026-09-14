//! The project library on disk: one `<id>.spatt.json` file per project in a single directory.
//!
//! Shared by the desktop app (rooted in its data folder) and the network server's project API.
//! Like every store in the web UI (`src/io/store.ts`), it deals in project file text: validating
//! a project is the web UI's job, so a file that no longer parses still lists and still reads.

use std::fmt;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

/// Suffix of every project file in the store.
pub const PROJECT_FILE_EXTENSION: &str = ".spatt.json";

/// Suffix of the temporary file a write goes through before it replaces the project file.
const TEMP_SUFFIX: &str = ".tmp";

/// `updatedAt` for a file whose own value cannot be read: the epoch, as the browser store does.
const EPOCH: &str = "1970-01-01T00:00:00.000Z";

/// Mirrors `ProjectSummary` in `src/io/store.ts`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub updated_at: String,
    pub intersection_count: usize,
}

#[derive(Debug)]
pub enum StoreError {
    /// The id does not match `PROJECT_ID_PATTERN`, so it cannot safely become a file name.
    InvalidId(String),
    /// A conditional write or remove found the project in another state than expected: changed
    /// since it was read (`current` is its version now), deleted (`None`), or already present.
    Conflict {
        current: Option<String>,
    },
    Io(io::Error),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::InvalidId(id) => write!(f, "project id \"{id}\" cannot be stored"),
            StoreError::Conflict { .. } => write!(f, "the project was changed elsewhere"),
            StoreError::Io(error) => write!(f, "project store: {error}"),
        }
    }
}

impl std::error::Error for StoreError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            StoreError::InvalidId(_) | StoreError::Conflict { .. } => None,
            StoreError::Io(error) => Some(error),
        }
    }
}

/// What a conditional write or remove expects to find.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Expected<'a> {
    /// No condition: last write wins.
    Any,
    /// The project must not exist yet.
    Absent,
    /// The project must exist with this version.
    Version(&'a str),
}

/// A project's version: a hash of its file text (FNV-1a, 64 bits, as 16 hex digits). Stable
/// across restarts and platforms, so a client's version survives a server restart. It detects
/// concurrent edits; it is not a security measure.
pub fn version_of(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

impl From<io::Error> for StoreError {
    fn from(error: io::Error) -> Self {
        StoreError::Io(error)
    }
}

/// `^[a-z0-9][a-z0-9-]{0,62}$`, the same rule as `PROJECT_ID_PATTERN` in `src/io/store.ts`.
/// Excludes `.`, `/`, `\` and `:`, so an id can never leave the store's directory.
pub fn is_valid_project_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    match bytes.first() {
        Some(first) if first.is_ascii_lowercase() || first.is_ascii_digit() => {}
        _ => return false,
    }
    bytes.len() <= 63
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

/// Clones share one lock, so every clone handed to the desktop app's commands and to the server's
/// API checks and writes a project as one step. (Two processes on one folder are kept apart by
/// the app's single-instance lock, not here.)
#[derive(Clone, Debug)]
pub struct FileProjectStore {
    dir: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl FileProjectStore {
    /// A store in `dir`. Nothing touches the disk until the first write creates the directory.
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self {
            dir: dir.into(),
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Newest first; ties in `updatedAt` fall back to id order so the listing is stable.
    pub fn list(&self) -> Result<Vec<ProjectSummary>, StoreError> {
        let entries = match fs::read_dir(&self.dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let mut summaries = Vec::new();
        for entry in entries {
            let entry = entry?;
            let file_name = entry.file_name();
            let Some(id) = file_name
                .to_str()
                .and_then(|name| name.strip_suffix(PROJECT_FILE_EXTENSION))
            else {
                continue;
            };
            if !is_valid_project_id(id) || !entry.file_type()?.is_file() {
                continue;
            }
            let text = match fs::read_to_string(entry.path()) {
                Ok(text) => text,
                // Removed between listing the directory and reading it.
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                // Not UTF-8: still a project file the user may want to delete.
                Err(error) if error.kind() == io::ErrorKind::InvalidData => String::new(),
                Err(error) => return Err(error.into()),
            };
            summaries.push(summary_of(id, &text));
        }
        summaries.sort_by(|a, b| {
            b.updated_at
                .cmp(&a.updated_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(summaries)
    }

    /// The project's file text, or `None` if there is no such project.
    pub fn read(&self, id: &str) -> Result<Option<String>, StoreError> {
        let path = self.path_of(id)?;
        match fs::read_to_string(path) {
            Ok(text) => Ok(Some(text)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    /// The project's file text and version, or `None` if there is no such project.
    pub fn read_versioned(&self, id: &str) -> Result<Option<(String, String)>, StoreError> {
        Ok(self.read(id)?.map(|text| {
            let version = version_of(&text);
            (text, version)
        }))
    }

    /// Replaces the project atomically: the text goes to a temporary file in the same directory,
    /// is flushed to disk, and is then renamed over the project file, so a crash leaves either
    /// the old file or the new one, never a torn one.
    pub fn write(&self, id: &str, text: &str) -> Result<(), StoreError> {
        self.write_if(id, text, Expected::Any).map(|_| ())
    }

    /// Writes the project if it is in the `expected` state, resolving with its new version. A
    /// conditional write of exactly the text already stored succeeds without writing, whatever
    /// version it expected: the same save retried, or sent twice from one editor, is not a conflict.
    pub fn write_if(
        &self,
        id: &str,
        text: &str,
        expected: Expected<'_>,
    ) -> Result<String, StoreError> {
        let path = self.path_of(id)?;
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let version = version_of(text);
        if expected != Expected::Any {
            let current = self.read(id)?.map(|stored| version_of(&stored));
            if current.as_deref() == Some(version.as_str()) {
                return Ok(version);
            }
            check_against(current, expected)?;
        }
        fs::create_dir_all(&self.dir)?;
        let temp = self
            .dir
            .join(format!("{id}{PROJECT_FILE_EXTENSION}{TEMP_SUFFIX}"));
        let result = write_synced(&temp, text).and_then(|()| fs::rename(&temp, &path));
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result.map_err(StoreError::from)?;
        Ok(version)
    }

    /// Deletes the project. Removing a project that does not exist is not an error.
    pub fn remove(&self, id: &str) -> Result<(), StoreError> {
        self.remove_if(id, Expected::Any)
    }

    /// Deletes the project if it is in the `expected` state (`Expected::Absent` is a no-op check).
    pub fn remove_if(&self, id: &str, expected: Expected<'_>) -> Result<(), StoreError> {
        let path = self.path_of(id)?;
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.check(id, expected)?;
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    fn check(&self, id: &str, expected: Expected<'_>) -> Result<(), StoreError> {
        if expected == Expected::Any {
            return Ok(());
        }
        check_against(self.read(id)?.map(|text| version_of(&text)), expected)
    }

    fn path_of(&self, id: &str) -> Result<PathBuf, StoreError> {
        if !is_valid_project_id(id) {
            return Err(StoreError::InvalidId(id.to_owned()));
        }
        Ok(self.dir.join(format!("{id}{PROJECT_FILE_EXTENSION}")))
    }
}

/// Whether a project at version `current` (`None`: absent) satisfies `expected`.
fn check_against(current: Option<String>, expected: Expected<'_>) -> Result<(), StoreError> {
    let matches = match expected {
        Expected::Any => true,
        Expected::Absent => current.is_none(),
        Expected::Version(version) => current.as_deref() == Some(version),
    };
    if matches {
        Ok(())
    } else {
        Err(StoreError::Conflict { current })
    }
}

fn write_synced(path: &Path, text: &str) -> io::Result<()> {
    let mut file = fs::File::create(path)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()
}

/// Only the fields a summary needs; anything else in the file is ignored.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummaryFields {
    name: Option<serde_json::Value>,
    updated_at: Option<serde_json::Value>,
    intersections: Option<serde_json::Value>,
}

/// Summary fields read straight from the file text, tolerating a file that no longer validates
/// (the same rules as `summaryOf` in `src/io/browser-store.ts`).
fn summary_of(id: &str, text: &str) -> ProjectSummary {
    let fields = serde_json::from_str::<SummaryFields>(text).ok();
    let string =
        |value: Option<&serde_json::Value>| value.and_then(|v| v.as_str()).map(str::to_owned);
    let fields = fields.as_ref();
    ProjectSummary {
        id: id.to_owned(),
        name: string(fields.and_then(|f| f.name.as_ref())).unwrap_or_else(|| id.to_owned()),
        updated_at: string(fields.and_then(|f| f.updated_at.as_ref()))
            .unwrap_or_else(|| EPOCH.to_owned()),
        intersection_count: fields
            .and_then(|f| f.intersections.as_ref())
            .and_then(|v| v.as_array())
            .map_or(0, Vec::len),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str, updated_at: &str, intersections: usize) -> String {
        let intersections: Vec<_> = (0..intersections)
            .map(|i| serde_json::json!({ "id": format!("i{i}") }))
            .collect();
        serde_json::json!({
            "schemaVersion": 1,
            "name": name,
            "updatedAt": updated_at,
            "intersections": intersections,
        })
        .to_string()
    }

    fn store() -> (tempfile::TempDir, FileProjectStore) {
        let temp = tempfile::tempdir().unwrap();
        let store = FileProjectStore::new(temp.path().join("projects"));
        (temp, store)
    }

    #[test]
    fn id_rule_matches_the_web_ui() {
        let longest = "a".repeat(63);
        for ok in ["a", "0", "p-abc123", "a-", &longest] {
            assert!(is_valid_project_id(ok), "{ok} should be valid");
        }
        let too_long = "a".repeat(64);
        for bad in [
            "", "-a", "A", "a_b", "a.b", "..", "../x", "a/b", "a\\b", "c:", " a", "\u{e9}",
            &too_long,
        ] {
            assert!(!is_valid_project_id(bad), "{bad} should be invalid");
        }
    }

    #[test]
    fn empty_store_lists_nothing_without_creating_the_directory() {
        let (_temp, store) = store();
        assert_eq!(store.list().unwrap(), Vec::new());
        assert!(!store.dir().exists());
    }

    #[test]
    fn write_creates_the_directory_and_reads_back() {
        let (_temp, store) = store();
        let text = project("Main & 1st", "2026-09-01T10:00:00.000Z", 2);
        store.write("p-one", &text).unwrap();
        assert!(store.dir().join("p-one.spatt.json").is_file());
        assert_eq!(store.read("p-one").unwrap().as_deref(), Some(text.as_str()));
    }

    #[test]
    fn read_of_a_missing_project_is_none() {
        let (_temp, store) = store();
        assert_eq!(store.read("p-missing").unwrap(), None);
        store.write("p-other", "{}").unwrap();
        assert_eq!(store.read("p-missing").unwrap(), None);
    }

    /// `std::fs::rename` must replace an existing destination on every OS, Windows included.
    #[test]
    fn write_replaces_an_existing_file_and_leaves_no_temp_file() {
        let (_temp, store) = store();
        store
            .write("p-one", &project("Old", "2026-01-01T00:00:00.000Z", 1))
            .unwrap();
        let newer = project("New", "2026-02-01T00:00:00.000Z", 3);
        store.write("p-one", &newer).unwrap();
        assert_eq!(
            store.read("p-one").unwrap().as_deref(),
            Some(newer.as_str())
        );
        let names: Vec<_> = fs::read_dir(store.dir())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(names, vec!["p-one.spatt.json".to_owned()]);
    }

    #[test]
    fn write_over_a_stale_temp_file_succeeds() {
        let (_temp, store) = store();
        fs::create_dir_all(store.dir()).unwrap();
        fs::write(store.dir().join("p-one.spatt.json.tmp"), "torn").unwrap();
        store.write("p-one", "{}").unwrap();
        assert_eq!(store.read("p-one").unwrap().as_deref(), Some("{}"));
        assert!(!store.dir().join("p-one.spatt.json.tmp").exists());
    }

    #[test]
    fn failed_write_leaves_the_old_file_intact() {
        let (_temp, store) = store();
        store.write("p-one", "old").unwrap();
        // A directory where the temp file should go makes the write fail before the rename.
        fs::create_dir(store.dir().join("p-one.spatt.json.tmp")).unwrap();
        assert!(matches!(
            store.write("p-one", "new"),
            Err(StoreError::Io(_))
        ));
        assert_eq!(store.read("p-one").unwrap().as_deref(), Some("old"));
    }

    #[test]
    fn list_is_newest_first_with_summary_fields() {
        let (_temp, store) = store();
        store
            .write("p-old", &project("Old", "2026-01-01T00:00:00.000Z", 1))
            .unwrap();
        store
            .write("p-new", &project("New", "2026-03-01T00:00:00.000Z", 4))
            .unwrap();
        store
            .write("p-mid", &project("Mid", "2026-02-01T00:00:00.000Z", 0))
            .unwrap();
        let list = store.list().unwrap();
        let ids: Vec<_> = list.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["p-new", "p-mid", "p-old"]);
        assert_eq!(
            list[0],
            ProjectSummary {
                id: "p-new".into(),
                name: "New".into(),
                updated_at: "2026-03-01T00:00:00.000Z".into(),
                intersection_count: 4,
            }
        );
    }

    #[test]
    fn list_ties_fall_back_to_id_order() {
        let (_temp, store) = store();
        for id in ["p-b", "p-a", "p-c"] {
            store
                .write(id, &project(id, "2026-01-01T00:00:00.000Z", 0))
                .unwrap();
        }
        let ids: Vec<_> = store.list().unwrap().into_iter().map(|s| s.id).collect();
        assert_eq!(ids, ["p-a", "p-b", "p-c"]);
    }

    #[test]
    fn unparseable_files_still_list_like_the_browser_store() {
        let (_temp, store) = store();
        store.write("p-garbage", "not json {").unwrap();
        store.write("p-array", "[1, 2]").unwrap();
        store
            .write(
                "p-wrong-types",
                r#"{"name": 7, "updatedAt": null, "intersections": {"a": 1}}"#,
            )
            .unwrap();
        store
            .write("p-good", &project("Good", "2026-01-01T00:00:00.000Z", 1))
            .unwrap();
        fs::write(store.dir().join("p-binary.spatt.json"), [0xff, 0xfe, 0x00]).unwrap();

        let list = store.list().unwrap();
        assert_eq!(list.len(), 5);
        assert_eq!(list[0].id, "p-good");
        for summary in &list[1..] {
            assert_eq!(summary.name, summary.id);
            assert_eq!(summary.updated_at, EPOCH);
            assert_eq!(summary.intersection_count, 0);
        }
    }

    #[test]
    fn list_ignores_other_files_and_directories() {
        let (_temp, store) = store();
        store.write("p-one", "{}").unwrap();
        let dir = store.dir();
        fs::write(dir.join("p-two.spatt.json.tmp"), "{}").unwrap();
        fs::write(dir.join("notes.txt"), "hi").unwrap();
        fs::write(dir.join("Bad_Id.spatt.json"), "{}").unwrap();
        fs::write(dir.join(".spatt.json"), "{}").unwrap();
        fs::create_dir(dir.join("p-dir.spatt.json")).unwrap();
        let ids: Vec<_> = store.list().unwrap().into_iter().map(|s| s.id).collect();
        assert_eq!(ids, ["p-one"]);
    }

    #[test]
    fn remove_deletes_and_tolerates_missing() {
        let (_temp, store) = store();
        store.write("p-one", "{}").unwrap();
        store.remove("p-one").unwrap();
        assert_eq!(store.read("p-one").unwrap(), None);
        store.remove("p-one").unwrap();
    }

    #[test]
    fn remove_before_the_directory_exists_is_fine() {
        let (_temp, store) = store();
        store.remove("p-never").unwrap();
        assert!(!store.dir().exists());
    }

    #[test]
    fn invalid_ids_are_rejected_before_touching_the_disk() {
        let (temp, store) = store();
        fs::write(temp.path().join("secret.spatt.json"), "{}").unwrap();
        for id in ["../secret", "..", "a/b", "A", ""] {
            assert!(matches!(store.read(id), Err(StoreError::InvalidId(_))));
            assert!(matches!(
                store.write(id, "{}"),
                Err(StoreError::InvalidId(_))
            ));
            assert!(matches!(store.remove(id), Err(StoreError::InvalidId(_))));
        }
        assert!(!store.dir().exists());
        assert!(temp.path().join("secret.spatt.json").exists());
    }

    #[test]
    fn version_is_a_stable_content_hash() {
        // FNV-1a 64 test vectors: "" and "a".
        assert_eq!(version_of(""), "cbf29ce484222325");
        assert_eq!(version_of("a"), "af63dc4c8601ec8c");
        assert_ne!(version_of("{}"), version_of("{ }"));
    }

    #[test]
    fn conditional_writes_check_the_current_version() {
        let (_temp, store) = store();
        let v1 = store.write_if("p-one", "one", Expected::Absent).unwrap();
        assert_eq!(v1, version_of("one"));
        assert!(matches!(
            store.write_if("p-one", "again", Expected::Absent),
            Err(StoreError::Conflict { current: Some(ref v) }) if *v == v1
        ));

        let v2 = store
            .write_if("p-one", "two", Expected::Version(&v1))
            .unwrap();
        // A second device still holding v1 is refused and told the version it missed.
        assert!(matches!(
            store.write_if("p-one", "stale", Expected::Version(&v1)),
            Err(StoreError::Conflict { current: Some(ref v) }) if *v == v2
        ));
        assert_eq!(
            store.read_versioned("p-one").unwrap(),
            Some(("two".to_owned(), v2.clone()))
        );

        // The same save sent twice from v1 (or already stored text from any version) succeeds.
        assert_eq!(
            store.write_if("p-one", "two", Expected::Version(&v1)).unwrap(),
            v2
        );
        assert_eq!(store.write_if("p-one", "two", Expected::Absent).unwrap(), v2);

        store.write_if("p-one", "forced", Expected::Any).unwrap();
        assert_eq!(store.read("p-one").unwrap().as_deref(), Some("forced"));
    }

    #[test]
    fn conditional_write_to_a_deleted_project_conflicts() {
        let (_temp, store) = store();
        let v1 = store.write_if("p-one", "one", Expected::Absent).unwrap();
        store.remove("p-one").unwrap();
        assert!(matches!(
            store.write_if("p-one", "mine", Expected::Version(&v1)),
            Err(StoreError::Conflict { current: None })
        ));
        assert_eq!(store.read("p-one").unwrap(), None);
    }

    #[test]
    fn conditional_remove() {
        let (_temp, store) = store();
        let v1 = store.write_if("p-one", "one", Expected::Absent).unwrap();
        assert!(matches!(
            store.remove_if("p-one", Expected::Version("0000000000000000")),
            Err(StoreError::Conflict { .. })
        ));
        store.remove_if("p-one", Expected::Version(&v1)).unwrap();
        assert_eq!(store.read("p-one").unwrap(), None);
    }

    /// Clones share the lock, so concurrent check-and-write from many threads never loses an
    /// update: exactly one writer per version wins.
    #[test]
    fn clones_serialise_conditional_writes() {
        let (_temp, store) = store();
        let v0 = store.write_if("p-one", "0", Expected::Absent).unwrap();
        let winners: usize = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..8)
                .map(|n| {
                    let store = store.clone();
                    let v0 = v0.clone();
                    scope.spawn(move || {
                        store
                            .write_if("p-one", &format!("writer {n}"), Expected::Version(&v0))
                            .is_ok()
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|h| usize::from(h.join().unwrap()))
                .sum()
        });
        assert_eq!(winners, 1);
    }

    #[test]
    fn invalid_id_error_message() {
        let error = StoreError::InvalidId("../x".into());
        assert_eq!(error.to_string(), "project id \"../x\" cannot be stored");
        assert!(std::error::Error::source(&error).is_none());
    }

    #[test]
    fn summary_serializes_in_camel_case() {
        let json = serde_json::to_value(summary_of("p-x", &project("X", "t", 2))).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "id": "p-x", "name": "X", "updatedAt": "t", "intersectionCount": 2 })
        );
    }
}
