import { ImageResponse } from "next/og";

// Next 14 picks this up automatically and serves it at /icon.png. The output
// is used both as a regular favicon (via the metadata.icons pipeline) and as
// the maskable launcher icon referenced from the webmanifest.

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: 96,
        }}
      >
        <svg
          width="320"
          height="320"
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
