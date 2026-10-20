import QRCode from "qrcode";

/** A QR code (inline SVG) that encodes ONLY a public URL, never credential data. */
export async function QrCode({ url, label }: { url: string; label: string }) {
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 168, errorCorrectionLevel: "M" });
  return (
    <figure className="inline-block rounded-lg border border-neutral-200 bg-white p-2">
      <div role="img" aria-label={label} className="[&>svg]:h-40 [&>svg]:w-40" dangerouslySetInnerHTML={{ __html: svg }} />
    </figure>
  );
}
