# Desktop, Network and Headless

SPATT's interface is a single web application. It runs unchanged in three hosts, and only two
things differ between them: where projects are saved, and whether the manager window exists.

```mermaid
flowchart LR
    UI["SPATT web UI"]
    UI --> D["Desktop app window<br/>(Tauri)"]
    UI --> S["spatt-server<br/>(HTTP, localhost or LAN)"]
    UI --> B["Development server<br/>(Vite)"]
    D -. "starts / stops" .-> S
```

## Desktop app

Launching SPATT opens the **SPATT Manager**, a small window that:

- opens SPATT itself in its own window;
- starts and stops the built-in network server, and chooses whether it serves only this computer
  or your local network;
- shows where projects are kept, and recent server activity.

Projects are kept in the app's data folder (`projects` inside `%APPDATA%\com.micatechnologies.spatt`
on Windows, `~/Library/Application Support/com.micatechnologies.spatt` on macOS,
`~/.local/share/com.micatechnologies.spatt` on Linux).

## Sharing SPATT on your network

1. In the manager, press **Start**. The server now answers on this computer at
   `http://127.0.0.1:8787/` (**Open in browser**). Change the port before starting if 8787 is in
   use.
2. Turn on **Share on the local network**. The manager shows an **access link** with a QR code.
3. On a phone, tablet or another computer on the same network, open the link or scan the code.
   The link signs that browser in and it is remembered; the address bar then shows the plain
   address without the token.

Every device, and the SPATT window on the host computer, works on the **same project library**.
Your system may ask whether SPATT may accept network connections the first time it shares.

**Access.** Other devices always need the access link or its token; the host computer never
does. A browser that opens the plain address without it is asked to paste the token, which the
manager shows. **Generate a new token** (the refresh button) signs every other device out until
it is given the new link.

**Editing on two devices at once.** Every save checks that the project has not changed since
that device last loaded or saved it. If it has, saving pauses and a banner offers:

| Choice | Result |
|---|---|
| **Load their version** | Replaces what this device shows with the saved version; unsaved edits here are discarded. |
| **Keep mine** | Saves this device's version over theirs. |
| **Save mine as a copy** | Saves this device's version as a new project, *Name (copy)*, and leaves theirs as it is. |

Nothing is ever overwritten silently.

**Closing the manager.** While the server runs, closing the manager keeps it serving and puts a
SPATT icon in the system tray, with **Open SPATT**, **Open manager**, **Stop server** and **Quit
SPATT**. Turn off **Keep serving in the tray when this window is closed** to stop the server when
the manager closes instead.

## Headless server

`spatt-server` is the same server without a window, for an always-on machine (a home server, a
Raspberry Pi, a NAS) or a Linux box without a desktop. Download it from the
[release page](installation.md) and run it:

```bash
spatt-server                          # this computer only, http://127.0.0.1:8787/
spatt-server --bind 0.0.0.0           # your network; prints an access link with a new token
spatt-server --config spatt-server.toml
```

| Flag | Config key | Default |
|---|---|---|
| `--bind <ip>` | `bind` | `127.0.0.1` (this computer only) |
| `--port <n>` | `port` | `8787` |
| `--data <folder>` | `data_dir` | the desktop app's data folder for this user; projects go in `<folder>/projects` |
| `--token <token>` | `token` | none; generated for the run when binding to the network |
| `--config <file>` | | none |

Flags override the file. A token must be at least 16 letters, digits, `-` or `_`. Without a
configured token, binding to the network generates a new one at every start, so set `token` in
the config file to keep links working across restarts:

```toml
bind = "0.0.0.0"
port = 8787
data_dir = "/srv/spatt"
token = "replace-with-a-long-random-string"
```

The server logs the projects folder, the access link and every API request (never the token).
Stop it with ++ctrl+c++. Running it as a background service is described under
[Background modes](#background-modes).

Only one SPATT program uses a data folder at a time. `spatt-server` refuses to start on a folder the desktop app or the service already has open, and says which one holds it.

!!! warning "Home networks only"
    The server speaks plain HTTP and is meant for a trusted local network. Do not expose it to the
    internet.

## Background modes

The desktop app can keep serving projects without its window open. Choose a mode under **Run in
background** in the manager:

| Mode | Starts | Projects | Needs administrator rights | Tray icon |
|---|---|---|---|---|
| **Start at login** | When you sign in | Your own library | No | Yes |
| **System service** | At boot, before anyone signs in | A shared library for the computer | Yes | Yes, from a small companion that starts when you sign in |

Only one mode is installed at a time; choosing one removes the other. **Off** removes whichever
is installed.

### Start at login

SPATT starts with your session, without a window, and serves your projects with the settings in
the **Network server** card. Launching SPATT again opens the manager in that same program, so
there is never a second copy writing your files. On Windows this is an entry in your startup
programs, which Task Manager lists under **Startup apps**.

### System service

The service runs as a low-privilege system account and keeps its own library:

| System | Service | Library and settings |
|---|---|---|
| Windows | *SPATT Server* (runs as Local Service) | `%ProgramData%\Mica Technologies\SPATT` |
| Linux | `spatt.service` (systemd, runs as the `spatt` user) | `/var/lib/spatt` |
| macOS | `com.micatechnologies.spatt.server` (launchd daemon) | `/Library/Application Support/SPATT` |

- **Installing** offers to copy your projects into the service's library. Your own copy is kept.
- **Opening SPATT** while the service runs works on the service's library through its address on
  this computer. The app's own server stays off.
- **Network sharing, the port and the access token** for the service are set under **Run in
  background**. Changing them restarts the service and asks for administrator permission.
- **On Windows, network sharing** adds a firewall rule for SPATT's port on *private* networks
  (home or work), never public ones. Turning sharing off, or removing the service, removes the rule.
- **Removing** the service keeps its library unless you tick **Also delete**.
- **Log:** the service writes `server.log` in its data folder.

!!! note "Where this has been tested"
    Both modes were installed, run and removed on Windows 11. The Linux (systemd, XDG autostart)
    and macOS (launchd) installers follow the same design, but have not yet been tried on those
    systems.

### From the command line

```text
spatt --status                                          what is installed and running
spatt --install-headless --mode login                   start at login
spatt --install-headless --mode service [--copy-library-from <data folder>]
spatt --uninstall-headless --mode login|service [--delete-data]
spatt --configure-service [--port N] [--lan true|false] [--regenerate-token]
```

Commands that change the service ask for administrator permission (UAC on Windows, a password
prompt on Linux and macOS). Run from an administrator terminal, they don't ask. `spatt --headless`,
`spatt --tray` and `spatt --service` are what the background entries run; you don't normally start
them yourself.
