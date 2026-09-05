# Machine public keys

One file per machine that runs exdate, `<hostname>.pub`: the **public** half of the deploy key
that `deploy/install.sh` generated on that machine. The private half never leaves it.

They are here so that secrets can be **encrypted to the machine** rather than typed into it.
`.github/workflows/deliver-secrets.yml` reads the repository's secrets, encrypts each one to every
key in this directory with [age](https://age-encryption.org) (which takes ssh-ed25519 keys as
recipients), and commits the result to `deploy/secrets/`. The installer decrypts what it can with
its own private key and applies it - through the same probe gate as `deploy/set-rpc.sh` for an RPC
endpoint, so a value that cannot do the job is never written.

The installer publishes this machine's key itself, on every run, when it differs from what is
here. Nothing in this directory is secret.
