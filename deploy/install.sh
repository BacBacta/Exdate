#!/usr/bin/env bash
# Put the exdate capture watcher on a fresh Debian or Ubuntu machine.
#
# The watcher has to be present at an instant that happens once and cannot be
# read back: the issuer's quote when a multiplier change takes effect. GitHub's
# cron fires every 7 to 25 minutes against a nine-minute lead, so it catches
# about seven steps in ten. A process that is simply always there catches them
# all. This script is the shortest path to that process.
#
# Run it as root, twice:
#
#   curl -fsSL https://raw.githubusercontent.com/BacBacta/Exdate/HEAD/deploy/install.sh | bash
#
# The first pass makes a deploy key and stops, printing the public half for you
# to paste into GitHub. The private half is generated on this machine and never
# leaves it, which is the whole reason the key is not handed to you from
# anywhere else. The second pass clones, installs the service and starts it.
#
# Idempotent: re-running it is how you upgrade. It never deletes anything it did
# not create, and it refuses rather than guessing.
#
# Everything below lives in main(), called at the very end with stdin detached.
# That is not style, it is the fix for two failures this script had when it was
# piped into bash rather than saved first. Under `curl | bash` the script IS
# bash's stdin, so (1) any child that reads stdin - ssh above all, and git spawns
# ssh - swallows the rest of the source and bash silently stops where that child
# ran: pass two printed "GitHub accepts this key" and then did nothing at all,
# no clone, no service, exit 0. And (2) a download cut in half would run its
# first half. Wrapping the body in a function makes bash parse the whole file
# before executing a line of it, and `</dev/null` gives every child its own
# empty stdin.
set -euo pipefail

REPO_SSH="${EXDATE_REPO_SSH:-git@github.com:BacBacta/Exdate.git}"
BRANCH="${EXDATE_BRANCH:-claude/lance-en5q6j}"
DIR="${EXDATE_DIR:-/opt/exdate}"
USER_NAME="${EXDATE_USER:-exdate}"
NODE_MAJOR=22

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die() { printf '\n\033[31mstopped:\033[0m %s\n' "$*" >&2; exit 1; }

main() {

# Where am I? Checked before anything else, because the two wrong answers both
# look plausible from a phone: Termux ships apt and a shell, so the Debian check
# below passes there, and the root check then sends the operator off to install
# sudo for a machine that can never run this. Say it plainly instead.
if [ -n "${TERMUX_VERSION:-}" ] || case "${PREFIX:-}" in *com.termux*) true;; *) false;; esac; then
  die "this is Termux on Android, not the server.
  The watcher runs on the VPS. From here, connect to it first:

    ssh root@YOUR.SERVER.IP

  and run the same command there. Do not install sudo or tsu for this."
fi
command -v systemctl >/dev/null && [ -d /run/systemd/system ] || die "no systemd here, so there is nothing to install the service into.
  This belongs on the Linux server, reached with: ssh root@YOUR.SERVER.IP"
command -v apt-get >/dev/null || die "this expects Debian or Ubuntu; on anything else follow deploy/exdate-watcher.service by hand"
# Hetzner hands you a root shell, so this usually passes without sudo at all.
[ "$(id -u)" -eq 0 ] || die "run this as root: it creates a user and a systemd unit.
  On a fresh VPS you are already root; otherwise prefix the command with sudo."

say "1. Packages"
# Checked one by one: a box can have git and curl and no ssh-keygen, and
# grouping them meant openssh-client was never installed on exactly that box.
missing=()
command -v git         >/dev/null || missing+=(git)
command -v curl        >/dev/null || missing+=(curl)
command -v ssh-keygen  >/dev/null || missing+=(openssh-client)
command -v ssh-keyscan >/dev/null || missing+=(openssh-client)
if [ ${#missing[@]} -gt 0 ]; then
  note "installing ${missing[*]}"
  apt-get update -qq
  apt-get install -y -qq ca-certificates "${missing[@]}"
fi
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 20 ]; then
  note "installing node ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs
fi
GIT="$(command -v git)"
note "node $(node --version), git $($GIT --version | awk '{print $3}')"

say "2. Service account"
if ! id -u "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/$USER_NAME" --shell /usr/sbin/nologin "$USER_NAME"
  note "created $USER_NAME"
else
  note "$USER_NAME already exists"
fi
SSH_DIR="/home/$USER_NAME/.ssh"
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$SSH_DIR"

say "3. Deploy key"
KEY="$SSH_DIR/id_ed25519"
if [ ! -f "$KEY" ]; then
  sudo -u "$USER_NAME" "$(command -v ssh-keygen)" -t ed25519 -N '' -C "exdate-watcher@$(hostname)" -f "$KEY" >/dev/null
  note "generated; the private half stays in $KEY and goes nowhere else"
fi
[ -s "$KEY.pub" ] || die "the deploy key's public half is missing or empty at $KEY.pub.
  Delete $KEY and $KEY.pub, then run this again to regenerate the pair."
# GitHub's host key, pinned now so the watcher never has to answer a prompt.
# Some networks block outbound port 22 entirely; GitHub also serves SSH on 443,
# so that is tried before giving up, and a failure says which rather than
# dying with no message.
HOST_KEYS=""
SSH_HOST="github.com"; SSH_PORT=22
HOST_KEYS="$(ssh-keyscan -t ed25519 -T 10 github.com 2>/dev/null || true)"
if [ -z "$HOST_KEYS" ]; then
  note "port 22 to github.com is closed here; trying ssh.github.com:443"
  HOST_KEYS="$(ssh-keyscan -t ed25519 -T 10 -p 443 ssh.github.com 2>/dev/null || true)"
  if [ -n "$HOST_KEYS" ]; then
    SSH_HOST="ssh.github.com"; SSH_PORT=443
    REPO_SSH="${REPO_SSH/git@github.com:/ssh://git@ssh.github.com:443/}"
    printf 'Host github.com\n  HostName ssh.github.com\n  Port 443\n  User git\n' \
      | sudo -u "$USER_NAME" tee "$SSH_DIR/config" >/dev/null
    chmod 600 "$SSH_DIR/config"; chown "$USER_NAME:$USER_NAME" "$SSH_DIR/config"
    note "using ssh.github.com:443 for git"
  fi
fi
[ -n "$HOST_KEYS" ] || die "cannot reach GitHub over SSH on port 22 or 443. The watcher pushes what it captures, so it needs one of them open outbound."
printf '%s\n' "$HOST_KEYS" | sudo -u "$USER_NAME" tee "$SSH_DIR/known_hosts" >/dev/null
chmod 600 "$SSH_DIR/known_hosts"; chown "$USER_NAME:$USER_NAME" "$SSH_DIR/known_hosts"

# Does GitHub already accept this key for pushes? That is the gate between the
# two passes, and it is asked rather than assumed.
#
# Its answer is captured before it is searched, rather than piped into grep, and
# that is load-bearing under `set -o pipefail`. GitHub answers `ssh -T` with the
# greeting AND exit status 1 - it grants no shell - so a pipeline ending in a
# matching `grep -q` still reports failure, from ssh's own status or from the
# SIGPIPE grep sends it by exiting on the first match. The gate was therefore
# false even when the key was accepted, and the second pass could never happen:
# it printed "add the key" forever. Measured, then fixed.
AUTH="$(sudo -u "$USER_NAME" "$(command -v ssh)" -o StrictHostKeyChecking=yes -o BatchMode=yes -p "$SSH_PORT" -T "git@$SSH_HOST" 2>&1 || true)"
if printf '%s' "$AUTH" | grep -q "successfully authenticated"; then
  note "GitHub accepts this key"
else
  cat <<EOF

  This key is not on the repository yet. Add it, then run this script again.

    https://github.com/BacBacta/Exdate/settings/keys/new
    Title:              $(hostname) watcher
    Allow write access: TICK IT - the watcher commits what it captures

  Paste everything between the two markers, as ONE line. A phone terminal wraps
  it across several rows; it is still one line, and GitHub rejects it broken.

  ----- copy from here -----
EOF
  # Printed by its own command rather than expanded inside the heredoc: if the
  # file cannot be read, that must be an error on screen, not a blank space in
  # the middle of otherwise perfect instructions.
  cat "$KEY.pub"
  cat <<EOF
  ----- to here -----

EOF
  exit 0
fi

say "4. Repository at $DIR"
if [ -d "$DIR/.git" ]; then
  # Can the service account actually write into the object store? That is the
  # question, so it is the thing tested - by writing. A single `git` run as root
  # in this checkout (a pull, anything that writes) leaves files or directories
  # there that the account cannot add to, and every later `sudo -u $USER_NAME git
  # fetch` dies with "insufficient permission for adding an object to repository
  # database". Testing ownership instead was a proxy for this and missed it on a
  # real machine: the mode can be wrong while the owner is right, and a directory
  # deeper than .git/objects can be the one that refuses.
  # git does not write into .git/objects itself; it writes into the 256 fan-out
  # directories under it, and into pack/ and info/. So the question is whether
  # the service account can write to EVERY directory in there, and the way to
  # ask it is to run find as that account and let the kernel answer.
  #
  # Two weaker tests were tried on a real machine first and both passed while the
  # fetch still failed: looking for files not owned by the account (the mode can
  # be wrong while the owner is right), and writing a probe file into
  # .git/objects itself (which is writable even when objects/ab is not).
  unwritable="$(sudo -u "$USER_NAME" find "$DIR/.git" -type d ! -writable -print -quit 2>/dev/null || true)"
  if [ -n "$unwritable" ]; then
    note "$USER_NAME cannot write to $unwritable; repairing owner and mode under $DIR"
    chown -R "$USER_NAME:$USER_NAME" "$DIR"
    # Capital X on purpose: directories become traversable, plain files are not
    # made executable.
    chmod -R u+rwX "$DIR/.git"
    still="$(sudo -u "$USER_NAME" find "$DIR/.git" -type d ! -writable -print -quit 2>/dev/null || true)"
    [ -z "$still" ] || die "$USER_NAME still cannot write to $still after chown and chmod.
  Look at: ls -ld '$still' && df -h $DIR
  A full disk reports the same way as a permission problem here."
  fi
  sudo -u "$USER_NAME" "$GIT" -C "$DIR" fetch --quiet origin "$BRANCH"
  sudo -u "$USER_NAME" "$GIT" -C "$DIR" checkout --quiet "$BRANCH"
  sudo -u "$USER_NAME" "$GIT" -C "$DIR" reset --quiet --hard "origin/$BRANCH"
  note "updated to $(sudo -u "$USER_NAME" "$GIT" -C "$DIR" rev-parse --short HEAD)"
else
  [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ] && die "$DIR exists and is not an exdate checkout; move it or set EXDATE_DIR"
  install -d -o "$USER_NAME" -g "$USER_NAME" "$DIR"
  sudo -u "$USER_NAME" "$GIT" clone --quiet --branch "$BRANCH" "$REPO_SSH" "$DIR"
  note "cloned $BRANCH"
fi
sudo -u "$USER_NAME" "$GIT" -C "$DIR" config user.name 'exdate-watcher'
sudo -u "$USER_NAME" "$GIT" -C "$DIR" config user.email 'noreply@users.noreply.github.com'

say "5. This machine's public key, in the repository"
# So that secrets can be encrypted TO this machine (deploy/keys/README.md).
# Public half only; the private half stays in $KEY. Committed and pushed from the
# service account's own checkout, the way the watcher commits its captures.
PUB="$DIR/deploy/keys/$(hostname).pub"
install -d -o "$USER_NAME" -g "$USER_NAME" "$DIR/deploy/keys"
if cmp -s "$KEY.pub" "$PUB"; then
  note "already published as deploy/keys/$(hostname).pub"
else
  install -o "$USER_NAME" -g "$USER_NAME" -m 644 "$KEY.pub" "$PUB"
  sudo -u "$USER_NAME" "$GIT" -C "$DIR" add "deploy/keys/$(hostname).pub"
  sudo -u "$USER_NAME" "$GIT" -C "$DIR" -c user.name=exdate-watcher -c user.email=noreply@users.noreply.github.com \
    commit -q -m "Publish $(hostname)'s deploy key, so secrets can be encrypted to it" </dev/null
  if sudo -u "$USER_NAME" "$GIT" -C "$DIR" push -q origin "HEAD:$BRANCH" </dev/null; then
    note "published deploy/keys/$(hostname).pub - deliver-secrets will encrypt to it"
  else
    note "committed locally; the push failed and will be retried on the next run"
  fi
fi

say "6. Settings"
if [ ! -f "$DIR/.env" ]; then
  cat > "$DIR/.env" <<'EOF'
# Where the announcement and the applied notice go. With none set the watcher
# still captures and simply tells nobody. See .env.example for the full list.
# EXDATE_ALERT_WEBHOOK_URL=
# EXDATE_TELEGRAM_BOT_TOKEN=
# EXDATE_TELEGRAM_CHAT_ID=
EOF
  chown "$USER_NAME:$USER_NAME" "$DIR/.env"; chmod 600 "$DIR/.env"
  note "wrote $DIR/.env with the alert sinks commented out"
else
  note "$DIR/.env kept as it is"
fi

say "7. Delivered secrets"
# Whatever deliver-secrets.yml encrypted to this machine: decrypted with the key
# above, an RPC endpoint gated by the probe, the rest written to .env. The
# service is restarted below in any case.
bash "$DIR/deploy/pull-secrets.sh" || note "one or more delivered values were refused; see above"

say "8. Service"
# The unit ships with the defaults baked in; substitute whatever this run used,
# or a non-default EXDATE_USER/EXDATE_DIR would install a unit pointing at a
# path that does not exist. node's path is resolved too rather than assumed to
# be /usr/bin on every distribution.
NODE_BIN="$(command -v node)"
sed -e "s#^User=.*#User=$USER_NAME#" \
    -e "s#^WorkingDirectory=.*#WorkingDirectory=$DIR#" \
    -e "s#^EnvironmentFile=.*#EnvironmentFile=-$DIR/.env#" \
    -e "s#^ReadWritePaths=.*#ReadWritePaths=$DIR#" \
    -e "s#^ExecStart=.*#ExecStart=$NODE_BIN scripts/watch-effective-prices.mjs#" \
    "$DIR/deploy/exdate-watcher.service" > /etc/systemd/system/exdate-watcher.service
chmod 644 /etc/systemd/system/exdate-watcher.service
systemctl daemon-reload
note "installed exdate-watcher.service (user $USER_NAME, dir $DIR, node $NODE_BIN)"

say "9. Preflight"
if sudo -u "$USER_NAME" env HOME="/home/$USER_NAME" "$NODE_BIN" "$DIR/scripts/check-watcher.mjs"; then
  # enable + restart, not `enable --now`: the latter leaves an already-running
  # service untouched, so three re-installs in a row could update the checkout
  # and never load the new code. A restart is the only way the code on disk
  # becomes the code that runs.
  systemctl enable --quiet exdate-watcher
  systemctl restart exdate-watcher
  sleep 3
  systemctl is-active --quiet exdate-watcher && note "running" || die "service failed to start: journalctl -u exdate-watcher"
  cat <<EOF

  Done. It is watching.

    journalctl -u exdate-watcher -f      what it is doing
    systemctl restart exdate-watcher     after editing $DIR/.env

  Nothing else is required: the scheduled job already defaults to watchdog mode,
  so it checks this machine's heartbeat instead of capturing alongside it.

  Secrets reach this machine from the repository's settings, encrypted to the
  key published in step 5 - nothing is typed here. Two would make it better:

    RHC_RPC_URLS              a keyed RPC endpoint, primary first, Robinhood's last
    EXDATE_ALERT_WEBHOOK_URL  (or the Telegram pair) so the nine-minute lead reaches someone

  Add them at https://github.com/BacBacta/Exdate/settings/secrets/actions/new,
  run Actions -> deliver-secrets -> Run workflow, then run this script again:
  step 7 decrypts, probes, applies and step 9 restarts.

EOF
else
  die "preflight found something blocking; the service is installed but not started"
fi

}

# Stdin detached: see the note at the top. Without it, ssh eats the rest of this
# script when it arrives through a pipe.
main "$@" </dev/null
