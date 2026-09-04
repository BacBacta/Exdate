/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // @exdate/core is consumed as TypeScript source from the workspace.
  transpilePackages: ['@exdate/core'],
  // A container that carries only the traced server and its dependencies. The
  // page renders on the server - it reads the API over the compose network, so
  // the API's address never reaches the browser and needs no CORS grant.
  output: 'standalone',
}
