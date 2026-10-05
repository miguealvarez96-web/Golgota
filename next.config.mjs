/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Admite una imagen de 2 MB mas el pequeno overhead de multipart/form-data.
    serverActions: { bodySizeLimit: "3mb" },
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
