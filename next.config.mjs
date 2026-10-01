/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Admite una imagen de 2 MB mas el pequeno overhead de multipart/form-data.
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
