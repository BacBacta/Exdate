/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The site is a document, not a service: every published number is read from
  // the committed observations in ../../data at build time, so it exports to
  // plain files and deploys anywhere. The one exception is /wallet/, which
  // reads a visitor's balances from the chain in their own browser: there is
  // no server to do it for them, and a balance cannot be committed in advance.
  output: 'export',
  // /t/<address>/ is a directory with an index.html: every static host serves
  // that without URL rewriting, which is what broke the root once already.
  trailingSlash: true,
  // @exdate/core is consumed as TypeScript source from the workspace; the
  // wallet page bundles its dependency-free holdings codec.
  transpilePackages: ['@exdate/core'],
}
