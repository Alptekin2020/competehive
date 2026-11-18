"use client";

import { useEffect, useRef, useState } from "react";
import { isValidGtin } from "@competehive/shared";

// Ürün barkodunu kameradan okur (telefon arka kamerası ya da bilgisayar
// web kamerası). Tarayıcının kendi BarcodeDetector'ı varsa (Android Chrome,
// macOS Chrome) o kullanılır; yoksa (iOS Safari, Firefox, Windows) ZXing
// yalnızca gerektiğinde yüklenir. Kontrol hanesi geçmeyen okumalar atlanır:
// bulanık bir karede yanlış okunan rakamlar barkod alanına düşmesin.

const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a"];

interface DetectedBarcode {
  rawValue: string;
}

interface NativeBarcodeDetector {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

interface NativeBarcodeDetectorCtor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

function getNativeDetectorCtor(): NativeBarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: NativeBarcodeDetectorCtor })
    .BarcodeDetector;
  return ctor ?? null;
}

async function createNativeDetector(): Promise<NativeBarcodeDetector | null> {
  const Ctor = getNativeDetectorCtor();
  if (!Ctor) return null;
  try {
    const supported = (await Ctor.getSupportedFormats?.()) ?? NATIVE_FORMATS;
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    if (formats.length === 0) return null;
    return new Ctor({ formats });
  } catch (err) {
    console.warn("Native BarcodeDetector unavailable, falling back to ZXing", err);
    return null;
  }
}

/** Okunan değeri barkoda çevirir; geçersizse null. */
export function acceptScannedBarcode(raw: string): string | null {
  const digits = raw.trim();
  return isValidGtin(digits) ? digits : null;
}

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Kamera izni verilmedi. Tarayıcı ayarlarından bu siteye kamera izni verip tekrar deneyin ya da barkodu elle yazın.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Bu cihazda kamera bulunamadı. Barkodu elle yazabilirsiniz.";
  }
  if (name === "NotReadableError") {
    return "Kamera başka bir uygulama tarafından kullanılıyor. Onu kapatıp tekrar deneyin.";
  }
  return "Kamera açılamadı. Barkodu elle yazabilirsiniz.";
}

interface BarcodeScannerProps {
  onDetected: (gtin: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({ onDetected, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);
  // Effect yeniden kurulmasın diye geri çağırma ref'te tutulur.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopZxing: (() => void) | null = null;
    let done = false;

    const finish = (gtin: string) => {
      if (done || cancelled) return;
      done = true;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(80);
      onDetectedRef.current(gtin);
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "Bu tarayıcı kameraya erişemiyor. Güncel bir tarayıcı kullanın ya da barkodu elle yazın.",
        );
        setStarting(false);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (err) {
        console.warn("Camera access failed", err);
        if (!cancelled) {
          setError(cameraErrorMessage(err));
          setStarting(false);
        }
        return;
      }
      const video = videoRef.current;
      if (cancelled || !video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const native = await createNativeDetector();
      if (cancelled) return;

      if (native) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch (err) {
          console.warn("Camera preview play failed", err);
        }
        setStarting(false);
        let busy = false;
        const tick = async () => {
          if (cancelled || done) return;
          if (!busy && video.readyState >= 2) {
            busy = true;
            try {
              const codes = await native.detect(video);
              for (const code of codes) {
                const gtin = acceptScannedBarcode(code.rawValue);
                if (gtin) {
                  finish(gtin);
                  return;
                }
              }
            } catch (err) {
              console.warn("Barcode detect failed", err);
            } finally {
              busy = false;
            }
          }
          frame = requestAnimationFrame(() => void tick());
        };
        frame = requestAnimationFrame(() => void tick());
        return;
      }

      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all(
          [import("@zxing/browser"), import("@zxing/library")],
        );
        if (cancelled) return;
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
        ]);
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 150,
        });
        const controls = await reader.decodeFromStream(stream, video, (result) => {
          if (!result) return;
          const gtin = acceptScannedBarcode(result.getText());
          if (gtin) finish(gtin);
        });
        stopZxing = () => controls.stop();
        if (cancelled) stopZxing();
        setStarting(false);
      } catch (err) {
        console.error("ZXing barcode reader failed to start", err);
        if (!cancelled) {
          setError("Barkod okuyucu başlatılamadı. Barkodu elle yazabilirsiniz.");
          setStarting(false);
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stopZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4">
      <div className="w-full max-w-md bg-dark-900 border border-dark-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">Barkodu okut</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-dark-400 hover:text-white text-sm px-2 py-1"
          >
            Kapat
          </button>
        </div>

        {error ? (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        ) : (
          <>
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                className="absolute inset-0 h-full w-full object-cover"
                muted
                playsInline
                autoPlay
              />
              <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-hive-400/80" />
              {starting && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-dark-300">
                  Kamera açılıyor...
                </div>
              )}
            </div>
            <p className="text-xs text-dark-400 mt-3 leading-relaxed">
              Ürünün üzerindeki barkodu çerçevenin içine yatay tutun. Okununca otomatik kapanır.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
