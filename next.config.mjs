/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Admite un comprobante de 5 MB mas el overhead de multipart/form-data.
    // Cada flujo conserva además su límite específico en la validación server-side.
    serverActions: { bodySizeLimit: "6mb" },
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
