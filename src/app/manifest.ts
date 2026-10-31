import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Foot Simu – Football Simulator",
    short_name: "Foot Simu",
    description: "Free football simulator for the Premier League, La Liga, Bundesliga, Serie A, Ligue 1 and Brasileirão.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#166534",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
