/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The site is a document, not a service: every number on it is read from the
  // committed observations in ../../data at build time, so it exports to plain
  // files and deploys anywhere. Live data is the status page's job.
  output: 'export',
  trailingSlash: false,
}
