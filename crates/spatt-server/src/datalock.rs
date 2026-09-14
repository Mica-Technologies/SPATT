//! One SPATT process at a time per data folder.
//!
//! Every process that writes a project library (the desktop app, a headless server, the system
//! service) holds an exclusive lock on `<data dir>/.spatt.lock` for as long as it runs. The
//! operating system releases it when the process exits, however it exits, so a crash never leaves a
//! folder locked. A second process on the same folder learns who holds it (from `.spatt.owner`,
//! which is not locked, since Windows will not read a locked file through another handle) and
//! attaches to that process instead of writing the files itself.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

pub const LOCK_FILE: &str = ".spatt.lock";
pub const OWNER_FILE: &str = ".spatt.owner";

/// Held while this process owns a data folder; dropping it releases the folder.
#[derive(Debug)]
pub struct DataLock {
    file: File,
    path: PathBuf,
}

#[derive(Debug)]
pub enum LockError {
    /// Another process holds the folder. `holder` is what it wrote into the lock file, if readable
    /// (for example `spatt --service, pid 1234`).
    Held {
        holder: Option<String>,
    },
    Io(std::io::Error),
}

impl std::fmt::Display for LockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LockError::Held {
                holder: Some(holder),
            } => write!(f, "the data folder is in use by {holder}"),
            LockError::Held { holder: None } => {
                write!(f, "the data folder is in use by another SPATT process")
            }
            LockError::Io(error) => write!(f, "could not lock the data folder: {error}"),
        }
    }
}

impl std::error::Error for LockError {}

impl DataLock {
    /// Takes the folder for this process, describing it as `holder` for anyone who finds it taken.
    pub fn acquire(data_dir: &Path, holder: &str) -> Result<Self, LockError> {
        std::fs::create_dir_all(data_dir).map_err(LockError::Io)?;
        let path = data_dir.join(LOCK_FILE);
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)
            .map_err(LockError::Io)?;
        match file.try_lock() {
            Ok(()) => {}
            Err(std::fs::TryLockError::WouldBlock) => {
                return Err(LockError::Held {
                    holder: holder_of(data_dir),
                });
            }
            Err(std::fs::TryLockError::Error(error)) => return Err(LockError::Io(error)),
        }
        let note = format!("{holder}, pid {}", std::process::id());
        // Best effort: the lock is what matters, the note only explains it.
        let _ = File::create(data_dir.join(OWNER_FILE))
            .and_then(|mut owner| owner.write_all(note.as_bytes()));
        Ok(Self { file, path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for DataLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}

/// Whether another process holds `data_dir`, without taking it.
pub fn is_held(data_dir: &Path) -> bool {
    let Ok(file) = OpenOptions::new()
        .read(true)
        .write(true)
        .open(data_dir.join(LOCK_FILE))
    else {
        return false;
    };
    match file.try_lock() {
        Ok(()) => {
            let _ = file.unlock();
            false
        }
        Err(std::fs::TryLockError::WouldBlock) => true,
        Err(std::fs::TryLockError::Error(_)) => false,
    }
}

/// Who holds `data_dir`, as its holder described itself, when another process holds it.
pub fn holder_of(data_dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(data_dir.join(OWNER_FILE)).ok()?;
    let text = text.trim().to_owned();
    (!text.is_empty()).then_some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_lock_on_the_same_folder_is_refused_until_the_first_is_dropped() {
        let temp = tempfile::tempdir().unwrap();
        let first = DataLock::acquire(temp.path(), "test one").unwrap();
        assert!(is_held(temp.path()));
        match DataLock::acquire(temp.path(), "test two") {
            Err(LockError::Held {
                holder: Some(holder),
            }) => assert!(holder.starts_with("test one, pid "), "{holder}"),
            other => panic!("expected the folder to be held, got {other:?}"),
        }
        drop(first);
        assert!(!is_held(temp.path()));
        let again = DataLock::acquire(temp.path(), "test three").unwrap();
        assert!(again.path().ends_with(LOCK_FILE));
    }

    #[test]
    fn different_folders_lock_independently() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let _a = DataLock::acquire(a.path(), "a").unwrap();
        let _b = DataLock::acquire(b.path(), "b").unwrap();
    }
}
