import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import dns from "node:dns/promises";
import crypto from "node:crypto";

export interface CaptureOptions {
  url: string;
  width?: number;
  height?: number;
  fullPage?: boolean;
  deviceScaleFactor?: number;
  timeoutMs?: number;
}

export interface CaptureTelemetry {
  protocol: string;
  statusCode: number;
  width: number;
  height: number;
  format: string;
  fileSize: number;
  durationMs: number;
  title: string;
  headings: string[];
  excerpt: string;
  linkCount: number;
  imageCount: number;
  canonicalUrl?: string;
  timestamp: string;
}

export interface CaptureResult {
  success: boolean;
  id: string;
  url: string;
  resolvedUrl: string;
  title: string;
  screenshotPath: string;
  publicUrl: string;
  width: number;
  height: number;
  format: string;
  fileSize: number;
  durationMs: number;
  telemetry: CaptureTelemetry;
  error?: string;
}

export class CaptureService {
  private static readonly CHROMIUM_PATH = "C:\\Users\\chera\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe";
  private static readonly CAPTURE_DIR = path.resolve(process.cwd(), "dist-renderer", "captures");

  /**
   * SSRF IP validation: validates target IP to reject loopback, link-local, and private subnets
   */
  public static isPrivateIp(ip: string): boolean {
    if (!ip) return true;
    if (ip === "localhost" || ip === "::1" || ip === "0.0.0.0") return true;

    // IPv4 checks
    const parts = ip.split(".").map(Number);
    if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
      if (parts[0] === 127) return true; // 127.0.0.0/8 Loopback
      if (parts[0] === 10) return true; // 10.0.0.0/8 Private
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12 Private
      if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16 Private
      if (parts[0] === 169 && parts[1] === 254) return true; // 169.254.0.0/16 Link-local / Cloud metadata
      if (parts[0] === 0) return true; // 0.0.0.0/8
    }

    // IPv6 checks
    const ipLower = ip.toLowerCase();
    if (ipLower.startsWith("fc") || ipLower.startsWith("fd") || ipLower.startsWith("fe80")) return true;

    return false;
  }

  /**
   * Validate and guard URL against SSRF and unauthorized protocols
   */
  public static async validateUrl(rawUrl: string): Promise<{ valid: boolean; normalizedUrl: string; error?: string }> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl.startsWith("http://") || rawUrl.startsWith("https://") ? rawUrl : `https://${rawUrl}`);
    } catch {
      return { valid: false, normalizedUrl: rawUrl, error: "Invalid URL format." };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, normalizedUrl: parsed.toString(), error: "Only HTTP and HTTPS protocols are permitted." };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (this.isPrivateIp(hostname)) {
      return { valid: false, normalizedUrl: parsed.toString(), error: "Access to private or local network hosts is blocked." };
    }

    // Resolve DNS to verify underlying IP is not a private/internal destination
    try {
      const lookup = await dns.lookup(hostname);
      if (this.isPrivateIp(lookup.address)) {
        return { valid: false, normalizedUrl: parsed.toString(), error: `Resolved host ${hostname} maps to protected internal address (${lookup.address}).` };
      }
    } catch (dnsErr: any) {
      return { valid: false, normalizedUrl: parsed.toString(), error: `Unable to resolve host: ${hostname} (${dnsErr.message})` };
    }

    return { valid: true, normalizedUrl: parsed.toString() };
  }

  /**
   * Execute real webpage screenshot capture and telemetry extraction via Playwright
   */
  public static async capture(options: CaptureOptions): Promise<CaptureResult> {
    const t0 = Date.now();
    const id = crypto.randomUUID();

    // 1. SSRF validation
    const validation = await this.validateUrl(options.url);
    if (!validation.valid) {
      throw new Error(validation.error || "SSRF validation failed for target URL.");
    }
    const targetUrl = validation.normalizedUrl;

    const width = Math.max(320, Math.min(options.width || 1280, 3840));
    const height = Math.max(240, Math.min(options.height || 800, 2160));
    const fullPage = Boolean(options.fullPage);
    const timeoutMs = Math.min(options.timeoutMs || 25000, 45000);

    await fs.mkdir(this.CAPTURE_DIR, { recursive: true });
    const filename = `capture_${id}.png`;
    const screenshotFilePath = path.join(this.CAPTURE_DIR, filename);
    const publicUrl = `/captures/${filename}`;

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: this.CHROMIUM_PATH,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });

      context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: options.deviceScaleFactor || 1,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NEXUS-PictureStudio/2.0 (Chromium/128)",
      });

      page = await context.newPage();

      // Navigate with timeout
      const response = await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });

      const statusCode = response ? response.status() : 200;
      const finalUrl = page.url();

      // Additional short wait for fonts / images to stabilize
      try {
        await page.waitForLoadState("networkidle", { timeout: 3500 });
      } catch {}

      // Extract real DOM telemetry directly from rendered DOM
      const domData = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const title = doc?.title || "";
        const headings: string[] = [];
        const hElements = doc?.querySelectorAll("h1, h2, h3, h4, h5, h6") || [];
        hElements.forEach((h: any) => {
          const text = (h.textContent || "").trim();
          if (text && headings.length < 20) {
            headings.push(`${h.tagName}: ${text}`);
          }
        });

        const bodyClone = doc?.body ? doc.body.cloneNode(true) : null;
        if (bodyClone) {
          const scripts = bodyClone.querySelectorAll("script, style, noscript, svg");
          scripts.forEach((s: any) => s.remove());
        }
        const excerpt = (bodyClone?.innerText || doc?.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 2500);

        const linkCount = doc?.querySelectorAll("a[href]")?.length || 0;
        const imageCount = doc?.querySelectorAll("img")?.length || 0;
        const canonical = doc?.querySelector('link[rel="canonical"]')?.getAttribute("href") || undefined;

        return {
          title,
          headings,
          excerpt,
          linkCount,
          imageCount,
          canonical,
        };
      });

      // Capture high-fidelity screenshot
      await page.screenshot({
        path: screenshotFilePath,
        fullPage,
        type: "png",
      });

      const fileStat = await fs.stat(screenshotFilePath);
      const durationMs = Date.now() - t0;

      const telemetry: CaptureTelemetry = {
        protocol: new URL(finalUrl).protocol.replace(":", ""),
        statusCode,
        width,
        height,
        format: "png",
        fileSize: fileStat.size,
        durationMs,
        title: domData.title || finalUrl,
        headings: domData.headings,
        excerpt: domData.excerpt,
        linkCount: domData.linkCount,
        imageCount: domData.imageCount,
        canonicalUrl: domData.canonical,
        timestamp: new Date().toISOString(),
      };

      return {
        success: true,
        id,
        url: targetUrl,
        resolvedUrl: finalUrl,
        title: domData.title || finalUrl,
        screenshotPath: screenshotFilePath,
        publicUrl,
        width,
        height,
        format: "png",
        fileSize: fileStat.size,
        durationMs,
        telemetry,
      };
    } finally {
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
  }
}
