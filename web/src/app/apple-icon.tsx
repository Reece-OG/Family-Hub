import { ImageResponse } from "next/og";

// iOS's "Add to Home Screen" flow picks this up at /apple-icon.png and uses
// it for the launcher tile. iOS wants a non-transparent 180x180 PNG with no
// rounded corners (iOS rounds them itself).

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #ff006e 0%, #8338ec 55%, #3a86ff 100%)",
        }}
      >
        <svg
          width="120"
          height="120"
          viewBox="0 0 64 64"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill="#ffffff"
            d="M16 44V24l16-10 16 10v20h-11V33h-10v11z"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
