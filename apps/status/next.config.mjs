/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // @exdate/core is consumed as TypeScript source from the workspace.
  transpilePackages: ['@exdate/core'],
}
