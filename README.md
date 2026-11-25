# Schematic

Grok Build vibe-coded framework-free browser-based database schema designer, using single-page HTML + CSS + TypeScript only. Largely based on another project, **[ERD Editor by SeungHwan-Lee](https://github.com/dineug/erd-editor)**. This watered-down version does not interoperate with other tools like the original does. It only exports its own custom JSON and an AI prompt version of your schema. Intended as an ideation tool.

The page loads the compiled modules in `source/dist/`. A browser can open `index.html` directly. Use a local server when the browser blocks module scripts on `file://`.

## Initial setup

1. Install toolbox
   `sudo dnf install toolbox`

2. Create and enter an isolated toolbox container
   ```
   toolbox create toolbox-schematic
   toolbox enter toolbox-schematic
   ```

3. Install dependencies
   `sudo dnf install -y typescript git python3`

4. Clone the repository and preview Schematic
   ```
   mkdir -p ~/Projects
   git clone https://github.com/makuharistudio/schematic.git
   cd schematic
   python3 -m http.server 8753
   ```
   - Open **[http://127.0.0.1:8753](http://127.0.0.1:8753)** in your browser

5. Still inside toolbox, generate an SSH key (email is a dummy string, ed25519 is the SSH key type). If done previously, no need to again
   - `ssh-keygen -t ed25519 -C "makuhari_studio@users.noreply.github.com"`
   - Press Enter to save to default location ~/.ssh/id_ed25519
   - Type a passphrase to protect the passkey on disk
   - View the public key `cat ~/.ssh/id_ed25519.pub`
   - Copy the entire contents of that public key to GitHub > Settings > SSH and GPG keys > New SSH key
   - Test it by running `ssh -T git@github.com`.
     - If it is the first time your computer has connected to GitHub via SSH, it will prompt:
      `Are you sure you want to continue connecting (yes/no/[fingerprint])?`
       To verify the server's identity.
       Check if the fingerprint received exactly matches one of these official GitHub fingerprints
       SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU ← (Ed25519) — most common now
       SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s ← (RSA)
       SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM ← (ECDSA)
       - If it matches, type yes and press Enter. SSH will add GitHub to your known_hosts file and you won't see this again.
       - It will reply "You've successfully authenticated"

6. Still inside toolbox, switch the repository remote from HTTPS to SSH (to make `git push` use your SSH key and not username/password)
   ```
   git remote set-url origin git@github.com:makuharistudio/schematic.git
   git remote -v   # confirm both fetch and push now show the git@github.com URL
   ```

7. Still inside toolbox, configure your identity based on the masking email in GitHub > Settings > Email
   ```
   git config --global user.name "makuharristudio"
   git config --global user.email "48945612+makuharistudio@users.noreply.github.com"
   ```

## Daily workflow

1. Enter the toolbox and the project
   ```
   toolbox enter toolbox-schematic
   cd ~/Projects/schematic
   ```

2. Edit the app
   - Shell and markup → `index.html`
   - TypeScript modules → `source/components/`
   - Themes and density → `source/style/app.css`
   - UI strings → `source/assets/languages.json`
   - Sample schemas → `samples/`

3. Compile and preview
   ```
   tsc -p tsconfig.json
   python3 -m http.server 8753
   ```
   - Open **[http://127.0.0.1:8753/](http://127.0.0.1:8753/)** in your browser

4. Publish your change
   ```
   git add .
   git commit -m "Your change description"
   git push origin main
   ```

**Notes**
- Run `tsc -p tsconfig.json` after changing TypeScript. The compiler writes `source/dist/` and is not part of the running app.
- No bundler and no runtime dependencies
- Commit the compiled files in `source/dist/` so the page opens without a build step
- Host has been cleaned of partial Node.js/npm installations

See `memory-bank.md` for architecture, decisions, and current feature status.

## Files

- `index.html` — application shell
- `source/components/` — TypeScript modules
- `source/dist/` — compiled JavaScript the page loads (no bundler required)
- `source/style/app.css` — themes and density
- `source/assets/marks.svg` — crow’s-foot marks and icons
- `source/assets/languages.json` — UI strings. Update this file whenever a label changes.
- `samples/` — example schema JSON
- `memory-bank.md` — development log and locked JSON shapes

Compile after editing TypeScript (dev machine only; the compiler is not part of the app):

```
node /tmp/ts5/package/lib/tsc.js -p tsconfig.json
```

## Document shapes

Schema files use `kind: "schematic.schema"` and settings files use `kind: "schematic.settings"`. Both are version `1`. Field lists are in `memory-bank.md`.
