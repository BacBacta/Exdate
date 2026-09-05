# Delivered secrets

Written by `.github/workflows/deliver-secrets.yml`: each repository secret in its list, encrypted
with age to every key in `deploy/keys/`. Only a machine holding one of those private keys can read
them, and the private keys were generated on those machines and never copied anywhere.

Trigger the workflow by hand after adding or changing a secret (Actions → deliver-secrets → Run
workflow); it also runs when a new machine key is published. age output is randomised, so every
run rewrites the files even when the plaintext did not change - a commit here means the workflow
ran, not necessarily that a value moved.

`deploy/install.sh` applies them on its next run, and `deploy/pull-secrets.sh` does so on demand.
