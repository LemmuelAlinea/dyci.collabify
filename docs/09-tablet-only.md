# Working from the tablet alone

A full Collabify workstation on an Android tablet — edit, run, test, render the
report, push, deploy. No desktop involved at any step.

Written against a Xiaomi Pad 7 (HyperOS 2, Snapdragon 7+ Gen 3, 8 GB). Any arm64
Android 13+ tablet with 8 GB works the same way.

## What you need first

- A Bluetooth or case keyboard. This is not optional in practice — the on-screen
  keyboard eats half the screen and has no Ctrl.
- Termux from [F-Droid](https://f-droid.org/packages/com.termux/) or its GitHub
  releases. Not the Play Store build: it is abandoned and its packages fail.

## 1. One Linux, not two

Everything runs inside a Debian container under Termux. Termux's own Node works
for the app, but it has no Chromium, so `npm run docs` would still need another
machine. Debian has both.

```bash
pkg update && pkg install proot-distro
```

```bash
proot-distro install debian
```

```bash
proot-distro login debian
```

That last line is how you start every session from here on.

## 2. Tools inside Debian

```bash
apt update && apt install -y curl git chromium ca-certificates
```

Debian's Node is too old for Vite 7, which wants 20.19+. Use nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```

Then reopen the shell and:

```bash
nvm install 22
```

## 3. The repo

Clone into the container's home. Never onto `/sdcard` — shared storage has no
symlinks and no exec bit, so `npm install` fails there in confusing ways.

```bash
git clone https://github.com/LemmuelAlinea/dyci.collabify.git
```

```bash
cd dyci.collabify && npm install
```

GitHub needs a personal access token instead of a password. Make one in the
browser under Settings → Developer settings → Tokens, scope `repo`, then:

```bash
git config --global credential.helper store
```

The first `git push` asks once and remembers it.

## 4. Secrets

`.env.local` is gitignored, so it does not arrive with the clone. Copy
`.env.example` to `.env.local` and fill it from the Supabase dashboard in the
tablet's browser — API keys under Settings → API, the pooled connection string
under Settings → Database. Nothing here needs the old machine.

## 5. Run it

```bash
npm run dev
```

Open `http://localhost:5173` in Chrome on the tablet. HMR works over loopback.
Split-screen Termux and Chrome so you see both.

`npm run check`, `npm run build`, `npm run docs` and `node scripts/db.mjs` all
work as they do on a desktop. The renderer finds Debian's Chromium on PATH by
itself; if you ever move it, set `CHROME_PATH`.

## 6. Deploys

Vercel builds from GitHub, so `git push` is the deploy. Watch the build and edit
environment variables in the Vercel dashboard in the browser.

## 7. Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

```bash
apt install -y ripgrep
```

Android is not an officially supported platform, so expect the occasional rough
edge. The alternative with no install at all is claude.ai/code in the browser,
which runs against the GitHub repo.

## Things that bite

- **HyperOS kills background apps.** Turn off battery optimisation for Termux and
  turn on autostart, or the dev server dies when you switch to Chrome. Run
  `termux-wake-lock` before a long build.
- **There are no DevTools on Android Chrome.** Inject
  [Eruda](https://github.com/liriliri/eruda) in dev for a console, network and
  element inspector. It covers most of what you would reach for.
- **The tablet is now the only copy.** Uninstalling Termux deletes the container
  and everything in it. Push often; that is the backup.
- **proot costs about a fifth of the speed** on syscall-heavy work like
  `npm install`. Builds and dev server feel close to native.
